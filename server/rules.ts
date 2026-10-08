// Deterministic rules. They run before any AI call because they are free, instant and predictable.
// The rules are deliberately conservative: when a case is not clear cut they return null
// and the model handles it.

import type { Department, MappingTarget, Seniority, TargetField } from "../shared/schema";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isValidEmail = (value: string): boolean => EMAIL_RE.test(value.trim());

export const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const HEADER_ALIASES: Record<TargetField, string[]> = {
  email: ["email", "e mail", "email address", "e mail address", "work email", "business email"],
  first_name: ["first name", "firstname", "given name", "fname"],
  last_name: ["last name", "lastname", "surname", "family name", "lname"],
  company: ["company", "company name", "organization", "organisation", "account name", "employer"],
  job_title: ["job title", "jobtitle", "title", "role"],
  country: ["country", "country region", "country code"],
  phone: ["phone", "phone number", "telephone", "mobile", "mobile phone", "tel"],
};

export interface RuleMapping {
  target: MappingTarget;
  confidence: number;
  reason: string;
}

export function mapColumnByRule(header: string, samples: string[]): RuleMapping | null {
  const key = normalizeText(header);
  for (const [target, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(key)) {
      return { target: target as TargetField, confidence: 1, reason: "Header matches a known name" };
    }
  }
  // Content check: a column full of email addresses is an email column whatever it is called.
  const filled = samples.filter((s) => s.trim() !== "");
  if (filled.length > 0 && filled.filter(isValidEmail).length / filled.length >= 0.8) {
    return { target: "email", confidence: 0.95, reason: "Values look like email addresses" };
  }
  return null;
}

const SENIORITY_PATTERNS: [Seniority, RegExp][] = [
  ["C-Level", /\b(chief|ceo|cto|cio|cfo|cmo|coo|chro|cro|ciso)\b/],
  ["VP", /\b(vp|svp|evp|vice president)\b/],
  ["Director", /\b(director|head of)\b/],
  ["Manager", /\b(manager|mgr)\b/],
];

const CONTRIBUTOR_PATTERN =
  /\b(engineer|developer|analyst|specialist|coordinator|representative|accountant|recruiter)\b/;

const DEPARTMENT_PATTERNS: [Department, RegExp][] = [
  ["Executive", /\b(chief executive|ceo)\b/],
  ["IT", /\b(it|information technology|infrastructure|security|cio|ciso)\b/],
  ["Engineering", /\b(engineering|engineer|software|developer|devops|cto)\b/],
  ["Marketing", /\b(marketing|brand|demand generation|cmo)\b/],
  ["Sales", /\b(sales|business development|cro)\b/],
  ["Finance", /\b(finance|financial|accounting|accountant|controller|cfo)\b/],
  ["HR", /\b(hr|human resources|people|talent|recruiting|recruiter|chro)\b/],
  ["Operations", /\b(operations|supply chain|logistics|procurement|coo)\b/],
];

// Words that change the meaning of a title ("Assistant to the Director"). Leave these to the model.
const AMBIGUITY_PATTERN = /\b(assistant|intern|student|to the|former|retired|acting)\b/;

export interface RuleTitle {
  seniority: Seniority;
  department: Department;
  confidence: number;
  reason: string;
}

export function titleByRule(title: string): RuleTitle | null {
  const text = normalizeText(title);
  if (!text || AMBIGUITY_PATTERN.test(text)) return null;

  const levels = SENIORITY_PATTERNS.filter(([, re]) => re.test(text)).map(([level]) => level);
  const departments = DEPARTMENT_PATTERNS.filter(([, re]) => re.test(text)).map(([dept]) => dept);

  // Only answer when exactly one level and exactly one department are recognised.
  if (levels.length > 1 || departments.length !== 1) return null;
  const seniority: Seniority | null =
    levels.length === 1 ? levels[0] : CONTRIBUTOR_PATTERN.test(text) ? "Individual Contributor" : null;
  if (!seniority) return null;

  return { seniority, department: departments[0], confidence: 0.95, reason: "Matched keyword rules" };
}
