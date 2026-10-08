import { describe, expect, it } from "vitest";
import { InvalidOutputError, parseSuggestions, titleSuggestion } from "../server/validate";

const good = { id: 0, seniority: "Director", department: "Marketing", confidence: 0.9, reason: "ok" };
const ids = new Set([0, 1]);

describe("model output validation", () => {
  it("accepts a clean JSON array", () => {
    expect(parseSuggestions(JSON.stringify([good]), titleSuggestion, ids).valid).toHaveLength(1);
  });

  it("copes with code fences and surrounding prose", () => {
    const text = "Here you go:\n```json\n" + JSON.stringify([good]) + "\n```";
    expect(parseSuggestions(text, titleSuggestion, ids).valid).toHaveLength(1);
  });

  it("drops items with values outside the allowed lists, and keeps the rest", () => {
    const invented = { ...good, id: 1, department: "Wizardry" };
    const result = parseSuggestions(JSON.stringify([good, invented]), titleSuggestion, ids);
    expect(result.valid.map((v) => v.id)).toEqual([0]);
    expect(result.dropped).toBe(1);
  });

  it("drops out of range confidence, unknown ids and duplicate ids", () => {
    const items = [{ ...good, confidence: 1.7 }, { ...good, id: 99 }, { ...good, id: 1 }, { ...good, id: 1 }];
    const result = parseSuggestions(JSON.stringify(items), titleSuggestion, ids);
    expect(result.valid.map((v) => v.id)).toEqual([1]);
    expect(result.dropped).toBe(3);
  });

  it("throws on output that is not JSON at all", () => {
    expect(() => parseSuggestions("I cannot help with that.", titleSuggestion, ids)).toThrow(InvalidOutputError);
    expect(() => parseSuggestions("[{broken", titleSuggestion, ids)).toThrow(InvalidOutputError);
  });
});
