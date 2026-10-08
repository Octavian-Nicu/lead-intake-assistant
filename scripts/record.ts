// Runs the sample file through the live model and saves the answers for mock mode.
// Run with: npm run record (needs ANTHROPIC_API_KEY in .env)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import type { RawRow } from "../shared/schema";
import { config } from "../server/config";
import { createClient } from "../server/llm";
import { analyzeColumns, newStats, normalizeRows } from "../server/pipeline";
import { normalizeText } from "../server/rules";

if (config.mode !== "live") {
  console.error("Recording needs a live model. Set ANTHROPIC_API_KEY in .env and unset LLM_MODE.");
  process.exit(1);
}

const path = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));
const csv = readFileSync(path("../data/sample_leads.csv"), "utf8");
const parsed = Papa.parse<RawRow>(csv, { header: true, skipEmptyLines: "greedy" });

const client = createClient();
const ctx = { client, config, requestId: "record", stats: newStats(client) };
const mapping = await analyzeColumns(parsed.meta.fields ?? [], parsed.data, ctx);
const rows = await normalizeRows(parsed.data, mapping, ctx);

const fixtures: Record<string, Record<string, unknown>> = { map_columns: {}, normalize_titles: {} };
for (const m of mapping) {
  if (m.method === "ai") {
    fixtures.map_columns[normalizeText(m.source)] = { target: m.target, confidence: m.confidence, reason: m.reason };
  }
}
for (const row of rows) {
  if (row.title.method === "ai") {
    const { method: _method, ...answer } = row.title;
    fixtures.normalize_titles[normalizeText(row.data.job_title)] = answer;
  }
}

writeFileSync(path("../fixtures/recorded.json"), JSON.stringify(fixtures, null, 2) + "\n");
console.log(
  `Saved ${Object.keys(fixtures.map_columns).length} column answers and ` +
    `${Object.keys(fixtures.normalize_titles).length} title answers. Cost: $${ctx.stats.costUsd.toFixed(4)}`,
);
