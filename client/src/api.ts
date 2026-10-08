import type { AnalyzeResponse, ColumnMapping, NormalizeResponse, RawRow } from "../../shared/schema";

export interface Health {
  mode: "live" | "mock";
  model: string;
  threshold: number;
}

// One place for all server calls, so every failure reaches the user as a readable message.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("Cannot reach the server. Check that it is running, then try again.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `The server answered with an error (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

const post = <T,>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const getHealth = (): Promise<Health> => request<Health>("/api/health");

export const getSample = async (): Promise<string> => {
  const response = await fetch("/api/sample");
  if (!response.ok) throw new Error("Could not load the sample file.");
  return response.text();
};

export const analyze = (csv: string): Promise<AnalyzeResponse> => post("/api/analyze", { csv });

export const normalize = (rows: RawRow[], mapping: ColumnMapping[]): Promise<NormalizeResponse> =>
  post("/api/normalize", { rows, mapping: mapping.map(({ source, target }) => ({ source, target })) });
