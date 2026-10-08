// The core of the app: rules first, then the model for what is left, then validation,
// and a safe fallback to human review whenever the model cannot be trusted or reached.

import type { z } from "zod";
import {
  TARGET_FIELDS,
  type ColumnMapping,
  type Method,
  type RawRow,
  type RowResult,
  type RunStats,
  type TargetField,
  type TitleResult,
} from "../shared/schema";
import type { Config } from "./config";
import type { LlmClient, LlmRequest } from "./llm/types";
import { log, totals } from "./logger";
import { columnPrompt, titlePrompt } from "./prompts";
import { isValidEmail, mapColumnByRule, normalizeText, titleByRule } from "./rules";
import { columnSuggestion, InvalidOutputError, parseSuggestions, titleSuggestion } from "./validate";

export interface RunContext {
  client: LlmClient;
  config: Pick<
    Config,
    "batchSize" | "concurrency" | "confidenceThreshold" | "priceInputPerMTok" | "priceOutputPerMTok"
  >;
  requestId: string;
  stats: RunStats;
}

export function newStats(client: LlmClient): RunStats {
  return {
    mode: client.mode,
    model: client.model,
    llmCalls: 0,
    llmFailures: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    byMethod: { rule: 0, ai: 0, cache: 0, fallback: 0, empty: 0 },
  };
}

// Title answers are cached in memory. Lead files repeat the same titles a lot,
// so this is the cheapest latency and cost win available.
const titleCache = new Map<string, TitleResult>();
export const clearTitleCache = (): void => titleCache.clear();

const MAX_ATTEMPTS = 2;

// One model call with logging, cost tracking and validation.
// Returns the items that passed validation. Throws only when every attempt failed.
async function askModel<T extends { id: number }>(
  ctx: RunContext,
  request: LlmRequest,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const expectedIds = new Set(request.items.map((item) => item.id));
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    try {
      const response = await ctx.client.complete(request);
      const latencyMs = Date.now() - started;
      const costUsd =
        ctx.client.mode === "mock"
          ? 0
          : (response.inputTokens / 1e6) * ctx.config.priceInputPerMTok +
            (response.outputTokens / 1e6) * ctx.config.priceOutputPerMTok;

      ctx.stats.llmCalls += 1;
      ctx.stats.latencyMs += latencyMs;
      ctx.stats.inputTokens += response.inputTokens;
      ctx.stats.outputTokens += response.outputTokens;
      ctx.stats.costUsd += costUsd;
      totals.llmCalls += 1;
      totals.llmLatencyMs += latencyMs;
      totals.inputTokens += response.inputTokens;
      totals.outputTokens += response.outputTokens;
      totals.costUsd += costUsd;

      const { valid, dropped } = parseSuggestions(response.text, schema, expectedIds);
      log("info", "llm_call", {
        requestId: ctx.requestId,
        task: request.task,
        model: ctx.client.model,
        attempt,
        items: request.items.length,
        valid: valid.length,
        dropped,
        latencyMs,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costUsd: Number(costUsd.toFixed(6)),
      });
      return valid;
    } catch (error) {
      lastError = error;
      ctx.stats.llmFailures += 1;
      totals.llmFailures += 1;
      log("warn", "llm_call_failed", {
        requestId: ctx.requestId,
        task: request.task,
        attempt,
        latencyMs: Date.now() - started,
        kind: error instanceof InvalidOutputError ? "invalid_output" : "provider_error",
        message: error instanceof Error ? error.message : String(error),
      });
      // Only malformed output is worth a second try here. Network and rate limit
      // errors were already retried with backoff inside the provider SDK.
      if (!(error instanceof InvalidOutputError)) break;
    }
  }
  throw lastError;
}

// ---------- Step 1: map source columns to the standard schema ----------

function sampleValues(rows: RawRow[], header: string, max = 3): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = (row[header] ?? "").trim();
    if (value) seen.add(value.slice(0, 60));
    if (seen.size >= max) break;
  }
  return [...seen];
}

const MANUAL_MAPPING = "No AI suggestion available. Choose a field or leave it ignored.";

export async function analyzeColumns(
  headers: string[],
  rows: RawRow[],
  ctx: RunContext,
): Promise<ColumnMapping[]> {
  const mapping: ColumnMapping[] = headers.map((source) => {
    // Rules look at more rows than we show, so the email content check is reliable.
    const rule = mapColumnByRule(source, sampleValues(rows, source, 20));
    const samples = sampleValues(rows, source);
    return rule
      ? { source, samples, ...rule, method: "rule" as Method }
      : { source, samples, target: "ignore", confidence: 0, reason: MANUAL_MAPPING, method: "fallback" };
  });

  const unresolved = mapping.map((m, id) => ({ m, id })).filter(({ m }) => m.method === "fallback");
  if (unresolved.length > 0) {
    try {
      const prompt = columnPrompt(unresolved.map(({ m, id }) => ({ id, header: m.source, samples: m.samples })));
      for (const suggestion of await askModel(ctx, prompt, columnSuggestion)) {
        Object.assign(mapping[suggestion.id], {
          target: suggestion.target,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          method: "ai",
        });
      }
    } catch {
      // Already logged. The columns stay on "fallback" and the user maps them by hand.
    }
  }

  // Two source columns must never feed the same target. Keep the most confident one.
  const best = new Map<string, ColumnMapping>();
  for (const m of mapping) {
    if (m.target === "ignore") continue;
    const current = best.get(m.target);
    if (!current || m.confidence > current.confidence) best.set(m.target, m);
  }
  for (const m of mapping) {
    if (m.target !== "ignore" && best.get(m.target) !== m) {
      m.reason = `Also looked like ${m.target}, but another column was a better match.`;
      m.target = "ignore";
      m.confidence = 0;
    }
  }

  for (const m of mapping) ctx.stats.byMethod[m.method] += 1;
  return mapping;
}

// ---------- Step 2: normalise job titles and check every row ----------

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

// Run async jobs with a fixed number in flight, so large files do not trip provider rate limits.
async function runPool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) await jobs[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

const EMPTY_TITLE: TitleResult = {
  seniority: "Unknown",
  department: "Unknown",
  confidence: 1,
  reason: "No job title in the file",
  method: "empty",
};

const FALLBACK_TITLE: TitleResult = {
  seniority: "Unknown",
  department: "Unknown",
  confidence: 0,
  reason: "The AI service gave no usable answer. Please classify this title yourself.",
  method: "fallback",
};

export async function classifyTitles(titles: string[], ctx: RunContext): Promise<Map<string, TitleResult>> {
  const results = new Map<string, TitleResult>();
  const forModel: string[] = [];

  // Work on unique titles only: 500 rows often contain fewer than 100 distinct titles.
  // The key is the normalised text; the model still sees the title as it was written.
  const originals = new Map<string, string>();
  for (const title of titles) {
    const key = normalizeText(title);
    if (key && !originals.has(key)) originals.set(key, title.trim());
  }

  for (const [key, title] of originals) {
    const rule = titleByRule(title);
    const cached = titleCache.get(key);
    if (rule) results.set(key, { ...rule, method: "rule" });
    else if (cached) results.set(key, { ...cached, method: "cache" });
    else forModel.push(key);
  }

  // Each batch succeeds or fails on its own. A failed batch only sends its own titles to review.
  const jobs = chunk(forModel, ctx.config.batchSize).map((batch) => async () => {
    try {
      const prompt = titlePrompt(batch.map((key, id) => ({ id, title: originals.get(key)! })));
      for (const { id, ...answer } of await askModel(ctx, prompt, titleSuggestion)) {
        const result: TitleResult = { ...answer, method: "ai" };
        results.set(batch[id], result);
        titleCache.set(batch[id], result);
      }
    } catch {
      // Already logged. Titles without an answer fall through to FALLBACK_TITLE below.
    }
  });
  await runPool(jobs, ctx.config.concurrency);

  for (const title of forModel) if (!results.has(title)) results.set(title, FALLBACK_TITLE);
  return results;
}

export async function normalizeRows(
  rows: RawRow[],
  mapping: Pick<ColumnMapping, "source" | "target">[],
  ctx: RunContext,
): Promise<RowResult[]> {
  const sourceFor = new Map<TargetField, string>();
  for (const m of mapping) if (m.target !== "ignore" && !sourceFor.has(m.target)) sourceFor.set(m.target, m.source);

  const mapped = rows.map((row) => {
    const data = {} as Record<TargetField, string>;
    for (const field of TARGET_FIELDS) data[field] = (row[sourceFor.get(field) ?? ""] ?? "").trim();
    return data;
  });

  const titles = await classifyTitles(mapped.map((data) => data.job_title), ctx);

  return mapped.map((data, index) => {
    const title = titles.get(normalizeText(data.job_title)) ?? EMPTY_TITLE;
    ctx.stats.byMethod[title.method] += 1;

    const issues: string[] = [];
    if (!data.email) issues.push("Missing email address");
    else if (!isValidEmail(data.email)) issues.push("Email address is not valid");

    let status: RowResult["status"] = "ok";
    if (issues.length > 0) {
      status = "invalid";
    } else if (title.method === "fallback" || title.confidence < ctx.config.confidenceThreshold) {
      status = "needs_review";
      issues.push(title.method === "fallback" ? "No AI suggestion" : "Low confidence suggestion");
    }
    return { index, data, title, status, issues };
  });
}
