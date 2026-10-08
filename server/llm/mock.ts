import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeText } from "../rules";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

// Mock provider. It replays saved answers from fixtures/recorded.json so the app, the tests
// and the demo run with no API key, no cost and no internet.
// Anything that is not in the fixtures gets no answer, which exercises the same
// "AI could not help, ask a human" path that a real outage would.

type Fixtures = Record<string, Record<string, Record<string, unknown>>>;

const FIXTURE_PATH = fileURLToPath(new URL("../../fixtures/recorded.json", import.meta.url));

export function createMockClient(latencyMs = 250): LlmClient {
  const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixtures;

  return {
    mode: "mock",
    model: "mock (recorded responses)",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      const known = fixtures[request.task] ?? {};
      const answers = request.items
        .filter((item) => known[normalizeText(item.text)])
        .map((item) => ({ id: item.id, ...known[normalizeText(item.text)] }));
      const text = JSON.stringify(answers);
      // Rough token estimate (about four characters per token) so the stats panel has data.
      return {
        text,
        inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
      };
    },
  };
}
