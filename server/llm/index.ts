import { config } from "../config";
import { createAnthropicClient } from "./anthropic";
import { createMockClient } from "./mock";
import type { LlmClient } from "./types";

export function createClient(): LlmClient {
  return config.mode === "live" ? createAnthropicClient(config) : createMockClient();
}
