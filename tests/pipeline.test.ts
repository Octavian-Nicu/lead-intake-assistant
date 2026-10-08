import { beforeEach, describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest, LlmResponse } from "../server/llm/types";
import { analyzeColumns, clearTitleCache, newStats, normalizeRows, type RunContext } from "../server/pipeline";

// A scripted model: each test decides exactly what "the AI" says, so no network is involved.
function fakeClient(reply: (request: LlmRequest, call: number) => string | Error) {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    mode: "live",
    model: "fake",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      requests.push(request);
      const result = reply(request, requests.length);
      if (result instanceof Error) throw result;
      return { text: result, inputTokens: 1000, outputTokens: 200 };
    },
  };
  return { client, requests };
}

function context(client: LlmClient): RunContext {
  return {
    client,
    requestId: "test",
    stats: newStats(client),
    config: { batchSize: 20, concurrency: 3, confidenceThreshold: 0.8, priceInputPerMTok: 1, priceOutputPerMTok: 5 },
  };
}

const answerTitles = (confidence: number) => (request: LlmRequest) =>
  JSON.stringify(
    request.items.map((item) => ({
      id: item.id,
      seniority: "Individual Contributor",
      department: "Sales",
      confidence,
      reason: "test",
    })),
  );

const MAPPING = [
  { source: "Email", target: "email" as const },
  { source: "Title", target: "job_title" as const },
];
const row = (email: string, title: string) => ({ Email: email, Title: title });

beforeEach(clearTitleCache);

describe("column mapping", () => {
  it("only asks the model about columns the rules could not map", async () => {
    const { client, requests } = fakeClient(() =>
      JSON.stringify([{ id: 1, target: "job_title", confidence: 0.9, reason: "job titles" }]),
    );
    const mapping = await analyzeColumns(["Email", "Position"], [{ Email: "a@b.com", Position: "CTO" }], context(client));

    expect(requests).toHaveLength(1);
    expect(requests[0].items.map((i) => i.text)).toEqual(["Position"]);
    expect(mapping.map((m) => [m.target, m.method])).toEqual([["email", "rule"], ["job_title", "ai"]]);
  });

  it("falls back to manual mapping when the provider is down", async () => {
    const { client } = fakeClient(() => new Error("connection refused"));
    const ctx = context(client);
    const mapping = await analyzeColumns(["Email", "Position"], [{ Email: "a@b.com", Position: "CTO" }], ctx);

    expect(mapping[0].method).toBe("rule"); // rule based work still succeeds
    expect(mapping[1]).toMatchObject({ target: "ignore", method: "fallback", confidence: 0 });
    expect(ctx.stats.llmFailures).toBe(1);
  });

  it("never maps two source columns to the same field", async () => {
    const { client } = fakeClient(() =>
      JSON.stringify([{ id: 1, target: "email", confidence: 0.6, reason: "looks like email" }]),
    );
    const mapping = await analyzeColumns(["Email", "Alt contact"], [{ Email: "a@b.com", "Alt contact": "x" }], context(client));
    expect(mapping.map((m) => m.target)).toEqual(["email", "ignore"]);
  });
});

describe("row processing", () => {
  it("handles clear titles with rules and makes no model call", async () => {
    const { client, requests } = fakeClient(answerTitles(0.9));
    const rows = await normalizeRows([row("a@b.com", "Marketing Manager")], MAPPING, context(client));
    expect(requests).toHaveLength(0);
    expect(rows[0]).toMatchObject({ status: "ok", title: { method: "rule", seniority: "Manager" } });
  });

  it("sends each distinct title to the model once, however many rows share it", async () => {
    const { client, requests } = fakeClient(answerTitles(0.9));
    const input = [row("a@b.com", "Account Executive"), row("c@d.com", "account executive "), row("e@f.com", "Founder")];
    const ctx = context(client);
    const rows = await normalizeRows(input, MAPPING, ctx);

    expect(requests).toHaveLength(1);
    expect(requests[0].items).toHaveLength(2);
    expect(rows.every((r) => r.status === "ok")).toBe(true);
    expect(ctx.stats.costUsd).toBeCloseTo(0.002); // 1000 in at $1/M plus 200 out at $5/M
  });

  it("answers repeat titles from the cache on the next file", async () => {
    const { client, requests } = fakeClient(answerTitles(0.9));
    await normalizeRows([row("a@b.com", "Founder")], MAPPING, context(client));
    const rows = await normalizeRows([row("c@d.com", "Founder")], MAPPING, context(client));
    expect(requests).toHaveLength(1);
    expect(rows[0].title.method).toBe("cache");
  });

  it("routes low confidence suggestions to human review", async () => {
    const { client } = fakeClient(answerTitles(0.5));
    const rows = await normalizeRows([row("a@b.com", "DevOps Ninja")], MAPPING, context(client));
    expect(rows[0]).toMatchObject({ status: "needs_review", issues: ["Low confidence suggestion"] });
  });

  it("retries once when the model returns malformed output", async () => {
    const { client, requests } = fakeClient((request, call) =>
      call === 1 ? "Sure! Here is the answer" : answerTitles(0.9)(request),
    );
    const ctx = context(client);
    const rows = await normalizeRows([row("a@b.com", "Founder")], MAPPING, ctx);
    expect(requests).toHaveLength(2);
    expect(rows[0].status).toBe("ok");
    expect(ctx.stats.llmFailures).toBe(1);
  });

  it("keeps working when the provider fails: rows go to review, nothing is lost", async () => {
    const { client } = fakeClient(() => new Error("timeout"));
    const input = [row("a@b.com", "Founder"), row("c@d.com", "Marketing Manager")];
    const rows = await normalizeRows(input, MAPPING, context(client));
    expect(rows[0]).toMatchObject({ status: "needs_review", title: { method: "fallback" } });
    expect(rows[1].status).toBe("ok"); // the rule based row is unaffected
  });

  it("isolates failures per batch", async () => {
    const { client } = fakeClient((request, call) => (call === 1 ? new Error("rate limited") : answerTitles(0.9)(request)));
    const ctx = context(client);
    ctx.config.batchSize = 1;
    ctx.config.concurrency = 1;
    const rows = await normalizeRows([row("a@b.com", "Founder"), row("c@d.com", "Owner")], MAPPING, ctx);
    expect(rows.map((r) => r.title.method)).toEqual(["fallback", "ai"]);
  });

  it("rejects rows with a missing or broken email before any review", async () => {
    const { client } = fakeClient(answerTitles(0.9));
    const rows = await normalizeRows([row("emma@", "CFO"), row("", "CFO")], MAPPING, context(client));
    expect(rows.map((r) => r.status)).toEqual(["invalid", "invalid"]);
    expect(rows[0].issues).toEqual(["Email address is not valid"]);
    expect(rows[1].issues).toEqual(["Missing email address"]);
  });

  it("treats a missing title as nothing to review", async () => {
    const { client, requests } = fakeClient(answerTitles(0.9));
    const rows = await normalizeRows([row("a@b.com", "")], MAPPING, context(client));
    expect(requests).toHaveLength(0);
    expect(rows[0]).toMatchObject({ status: "ok", title: { method: "empty", seniority: "Unknown" } });
  });
});
