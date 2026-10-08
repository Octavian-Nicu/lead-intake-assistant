import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

// Live provider. The SDK handles the transport concerns for us:
// a per request timeout, and automatic retries with backoff on 429, 5xx and network errors.
export function createAnthropicClient(config: Config): LlmClient {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 2 });

  return {
    mode: "live",
    model: config.model,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: 2000,
        temperature: 0, // classification task: we want repeatable answers, not creative ones
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      });
      const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
