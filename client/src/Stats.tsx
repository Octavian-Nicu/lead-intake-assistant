import type { RunStats } from "../../shared/schema";

// Makes the cost of each run visible to the person using the tool, not only to engineers reading logs.
export function Stats({ stats }: { stats: RunStats }) {
  const { byMethod } = stats;
  return (
    <aside className="stats" aria-label="Run details">
      <dl>
        <div>
          <dt>AI calls</dt>
          <dd>
            {stats.llmCalls}
            {stats.llmFailures > 0 && <span className="warn"> ({stats.llmFailures} failed)</span>}
          </dd>
        </div>
        <div>
          <dt>AI wait time</dt>
          <dd>{(stats.latencyMs / 1000).toFixed(1)} s</dd>
        </div>
        <div>
          <dt>Tokens in / out</dt>
          <dd>
            {stats.inputTokens.toLocaleString()} / {stats.outputTokens.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Estimated cost</dt>
          <dd>{stats.mode === "mock" ? "none (demo mode)" : `$${stats.costUsd.toFixed(4)}`}</dd>
        </div>
        <div>
          <dt>Decided by</dt>
          <dd>
            rules {byMethod.rule}, AI {byMethod.ai}, memory {byMethod.cache}, you {byMethod.fallback}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

export function mergeStats(a: RunStats | null, b: RunStats): RunStats {
  if (!a) return b;
  const byMethod = { ...a.byMethod };
  for (const key of Object.keys(b.byMethod) as (keyof RunStats["byMethod"])[]) byMethod[key] += b.byMethod[key];
  return {
    ...b,
    llmCalls: a.llmCalls + b.llmCalls,
    llmFailures: a.llmFailures + b.llmFailures,
    latencyMs: a.latencyMs + b.latencyMs,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    byMethod,
  };
}
