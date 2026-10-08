import type { Method } from "../../shared/schema";

const LABELS: Record<Method, string> = {
  rule: "Rule",
  ai: "AI",
  cache: "AI, seen before",
  fallback: "Needs you",
  empty: "Empty",
};

export function SourceBadge({ method }: { method: Method }) {
  return <span className={`badge badge-${method}`}>{LABELS[method]}</span>;
}

export function Confidence({ value, threshold }: { value: number; threshold: number }) {
  const low = value < threshold;
  return (
    <span className={`confidence ${low ? "low" : ""}`} title={low ? "Below the review threshold" : undefined}>
      {Math.round(value * 100)}%
    </span>
  );
}
