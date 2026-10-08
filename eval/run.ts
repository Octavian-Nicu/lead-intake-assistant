// Accuracy check for job title classification against a labelled set.
// Run with: npm run eval
// With an API key it measures rules plus the live model. Without one it measures the rules alone,
// because the mock client only knows the titles of the sample file.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Department, Method, Seniority } from "../shared/schema";
import { config } from "../server/config";
import { createClient } from "../server/llm";
import { classifyTitles, newStats } from "../server/pipeline";
import { normalizeText } from "../server/rules";

interface Labelled {
  title: string;
  seniority: Seniority;
  department: Department;
}

const labelled = JSON.parse(
  readFileSync(fileURLToPath(new URL("./titles.json", import.meta.url)), "utf8"),
) as Labelled[];

const client = createClient();
const stats = newStats(client);
const started = Date.now();
const results = await classifyTitles(
  labelled.map((l) => l.title),
  { client, config, requestId: "eval", stats },
);
const wallMs = Date.now() - started;

const tally: Record<string, { n: number; correct: number; autoAccepted: number; autoWrong: number }> = {};
const misses: string[] = [];

for (const item of labelled) {
  const got = results.get(normalizeText(item.title));
  const method: Method = got?.method ?? "empty";
  const correct = got?.seniority === item.seniority && got?.department === item.department;
  const auto = !!got && got.method !== "fallback" && got.confidence >= config.confidenceThreshold;
  const bucket = (tally[method] ??= { n: 0, correct: 0, autoAccepted: 0, autoWrong: 0 });
  bucket.n += 1;
  if (correct) bucket.correct += 1;
  if (auto) bucket.autoAccepted += 1;
  if (auto && !correct) bucket.autoWrong += 1;
  if (!correct && method !== "fallback") {
    misses.push(
      `  [${method}] "${item.title}": expected ${item.seniority} / ${item.department}, ` +
        `got ${got?.seniority} / ${got?.department} (confidence ${got?.confidence})`,
    );
  }
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(0)}%`);
const sum = (key: "n" | "correct" | "autoAccepted" | "autoWrong"): number =>
  Object.values(tally).reduce((total, bucket) => total + bucket[key], 0);

console.log(`\nJob title evaluation: ${labelled.length} labelled titles`);
console.log(`Mode: ${client.mode}, model: ${client.model}, review threshold: ${config.confidenceThreshold}\n`);
console.log("method     titles  correct  accuracy");
for (const [method, b] of Object.entries(tally)) {
  console.log(`${method.padEnd(10)} ${String(b.n).padStart(6)}  ${String(b.correct).padStart(7)}  ${pct(b.correct, b.n).padStart(8)}`);
}
const answered = sum("n") - (tally.fallback?.n ?? 0);
const answeredCorrect = sum("correct") - (tally.fallback?.correct ?? 0);
console.log(`\nAnswered by rules or model: ${answered} of ${labelled.length}`);
console.log(`Accuracy when answered:     ${pct(answeredCorrect, answered)}`);
console.log(`Left for a human (fallback): ${tally.fallback?.n ?? 0}`);
// The number that matters most for trust: how often a wrong answer skips human review.
console.log(`Auto accepted (no review):  ${sum("autoAccepted")}, of which wrong: ${sum("autoWrong")}`);
console.log(`Model calls: ${stats.llmCalls}, failures: ${stats.llmFailures}, wall time: ${wallMs} ms`);
console.log(`Tokens in/out: ${stats.inputTokens}/${stats.outputTokens}, cost: $${stats.costUsd.toFixed(4)}`);
if (misses.length > 0) console.log(`\nWrong answers:\n${misses.join("\n")}`);
console.log("");
