// The only contract the rest of the app has with a model provider.
// Adding another provider means writing one more file that implements LlmClient.

export type Task = "map_columns" | "normalize_titles";

export interface LlmRequest {
  task: Task;
  system: string;
  user: string;
  // The structured items behind the prompt. The mock client answers from these; live clients ignore them.
  items: { id: number; text: string }[];
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmClient {
  mode: "live" | "mock";
  model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
