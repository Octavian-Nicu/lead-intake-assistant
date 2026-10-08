import { describe, expect, it } from "vitest";
import { safeCell } from "../shared/csv";
import { isValidEmail, mapColumnByRule, titleByRule } from "../server/rules";

describe("column rules", () => {
  it("maps known header names regardless of case and punctuation", () => {
    expect(mapColumnByRule("E-mail Address", [])?.target).toBe("email");
    expect(mapColumnByRule("SURNAME", [])?.target).toBe("last_name");
    expect(mapColumnByRule("Country/Region", [])?.target).toBe("country");
  });

  it("recognises an email column by its values when the header is unknown", () => {
    expect(mapColumnByRule("Contact Mail", ["a@b.com", "c@d.org"])?.target).toBe("email");
  });

  it("leaves unknown headers to the model", () => {
    expect(mapColumnByRule("Position", ["CTO", "Manager"])).toBeNull();
  });
});

describe("job title rules", () => {
  it("classifies clear titles", () => {
    expect(titleByRule("Marketing Manager")).toMatchObject({ seniority: "Manager", department: "Marketing" });
    expect(titleByRule("VP of Sales")).toMatchObject({ seniority: "VP", department: "Sales" });
    expect(titleByRule("CFO")).toMatchObject({ seniority: "C-Level", department: "Finance" });
    expect(titleByRule("Sr. Software Engineer")).toMatchObject({
      seniority: "Individual Contributor",
      department: "Engineering",
    });
  });

  it("refuses to guess when a title is ambiguous", () => {
    expect(titleByRule("Account Manager")).toBeNull(); // no department keyword
    expect(titleByRule("Director of Sales Operations")).toBeNull(); // two departments
    expect(titleByRule("Assistant to the Director of Sales")).toBeNull(); // meaning changing word
    expect(titleByRule("Wizard of Light Bulb Moments")).toBeNull();
  });
});

describe("email check", () => {
  it("accepts normal addresses and rejects broken ones", () => {
    expect(isValidEmail("ana@example.com")).toBe(true);
    expect(isValidEmail("emma.dubois@")).toBe(false);
    expect(isValidEmail("n/a")).toBe(false);
  });
});

describe("export safety", () => {
  it("neutralises spreadsheet formulas but keeps phone numbers intact", () => {
    expect(safeCell("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(safeCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(safeCell("+40 721 000 111")).toBe("+40 721 000 111");
    expect(safeCell("Northwind")).toBe("Northwind");
  });
});
