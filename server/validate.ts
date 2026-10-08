import { z } from "zod";
import { DEPARTMENTS, SENIORITIES, TARGET_FIELDS } from "../shared/schema";

// Nothing the model returns is trusted until it passes these checks.

const base = {
  id: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
};

export const columnSuggestion = z.object({ ...base, target: z.enum([...TARGET_FIELDS, "ignore"]) });
export const titleSuggestion = z.object({
  ...base,
  seniority: z.enum(SENIORITIES),
  department: z.enum(DEPARTMENTS),
});

export type ColumnSuggestion = z.infer<typeof columnSuggestion>;
export type TitleSuggestion = z.infer<typeof titleSuggestion>;

export class InvalidOutputError extends Error {}

// Models sometimes wrap JSON in code fences or add a sentence around it. Extract the array.
export function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new InvalidOutputError("No JSON array in model output");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new InvalidOutputError("Model output is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new InvalidOutputError("Model output is not an array");
  return parsed;
}

// Validate item by item. One bad item is dropped (and later sent to human review)
// instead of throwing away a whole batch that was otherwise fine.
export function parseSuggestions<T extends { id: number }>(
  text: string,
  schema: z.ZodType<T>,
  expectedIds: Set<number>,
): { valid: T[]; dropped: number } {
  const valid: T[] = [];
  let dropped = 0;
  const seen = new Set<number>();
  for (const item of extractJsonArray(text)) {
    const result = schema.safeParse(item);
    // Reject ids we never asked about and duplicates, not only malformed items.
    if (result.success && expectedIds.has(result.data.id) && !seen.has(result.data.id)) {
      seen.add(result.data.id);
      valid.push(result.data);
    } else {
      dropped += 1;
    }
  }
  return { valid, dropped };
}
