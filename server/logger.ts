// Structured logging: one JSON object per line on stdout.
// In production these lines would be shipped to a log platform and queried by requestId.

type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.VITEST) return; // keep test output readable
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
}

// Process wide counters, exposed at GET /api/metrics. They reset when the server restarts.
export const totals = {
  requests: 0,
  llmCalls: 0,
  llmFailures: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  llmLatencyMs: 0,
  startedAt: new Date().toISOString(),
};
