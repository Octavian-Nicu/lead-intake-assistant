// Types and constants shared by the server and the browser client.
// Everything the model is allowed to answer is defined here as a closed list,
// so a made up value can never pass validation.

export const TARGET_FIELDS = [
  "email",
  "first_name",
  "last_name",
  "company",
  "job_title",
  "country",
  "phone",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];
export type MappingTarget = TargetField | "ignore";

export const SENIORITIES = [
  "C-Level",
  "VP",
  "Director",
  "Manager",
  "Individual Contributor",
  "Unknown",
] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const DEPARTMENTS = [
  "Executive",
  "IT",
  "Engineering",
  "Marketing",
  "Sales",
  "Finance",
  "HR",
  "Operations",
  "Other",
  "Unknown",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

// Where a suggestion came from. "fallback" means the AI could not help and a human must decide.
export type Method = "rule" | "ai" | "cache" | "fallback" | "empty";

export interface ColumnMapping {
  source: string;
  samples: string[];
  target: MappingTarget;
  confidence: number;
  reason: string;
  method: Method;
}

export interface TitleResult {
  seniority: Seniority;
  department: Department;
  confidence: number;
  reason: string;
  method: Method;
}

export type RowStatus = "ok" | "needs_review" | "invalid";

export interface RowResult {
  index: number;
  data: Record<TargetField, string>;
  title: TitleResult;
  status: RowStatus;
  issues: string[];
}

export interface RunStats {
  mode: "live" | "mock";
  model: string;
  llmCalls: number;
  llmFailures: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  byMethod: Record<Method, number>;
}

export interface AnalyzeResponse {
  rows: Record<string, string>[];
  mapping: ColumnMapping[];
  stats: RunStats;
}

export interface NormalizeResponse {
  rows: RowResult[];
  threshold: number;
  stats: RunStats;
}

export type RawRow = Record<string, string>;
