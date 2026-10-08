import "dotenv/config";

const num = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && process.env[name] !== undefined && process.env[name] !== ""
    ? parsed
    : fallback;
};

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";

export const config = {
  apiKey,
  // Mock mode is the default when there is no key, and can be forced for offline demos.
  mode: (process.env.LLM_MODE === "mock" || !apiKey ? "mock" : "live") as "mock" | "live",
  model: process.env.LLM_MODEL || "claude-haiku-4-5-20251001",
  priceInputPerMTok: num("PRICE_INPUT_PER_MTOK", 1),
  priceOutputPerMTok: num("PRICE_OUTPUT_PER_MTOK", 5),
  confidenceThreshold: num("CONFIDENCE_THRESHOLD", 0.8),
  batchSize: num("BATCH_SIZE", 20),
  concurrency: num("CONCURRENCY", 3),
  timeoutMs: num("LLM_TIMEOUT_MS", 20000),
  port: num("PORT", 3001),
  maxRows: num("MAX_ROWS", 2000),
};

export type Config = typeof config;
