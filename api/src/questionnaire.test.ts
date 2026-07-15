import { describe, it, expect } from "vitest";
import {
  validateQuestions, validateAnswers, computeFlagged, renderAnswers, validateDraftAnswers,
  type ReturnQuestion,
} from "./questionnaire.js";

const QS: ReturnQuestion[] = [
  { id: "q1", label: "What is on the card?", kind: "text" },
  { id: "q2", label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true },
  { id: "q3", label: "Card formatted FAT32?", kind: "yes_no" },
];

describe("validateQuestions", () => {
  it("accepts a valid config", () => {
    expect(validateQuestions(QS)).toBeNull();
    expect(validateQuestions([])).toBeNull();
  });
  it("rejects non-arrays and >10 questions", () => {
    expect(validateQuestions("nope")).toMatch(/array/);
    expect(validateQuestions(Array.from({ length: 11 }, (_, i) => ({ id: `q${i}`, label: "L", kind: "text" })))).toMatch(/10/);
  });
  it("rejects bad kind, empty/long labels, duplicate ids", () => {
    expect(validateQuestions([{ id: "a", label: "L", kind: "nope" }])).toMatch(/kind/);
    expect(validateQuestions([{ id: "a", label: "", kind: "text" }])).toMatch(/label/);
    expect(validateQuestions([{ id: "a", label: "x".repeat(201), kind: "text" }])).toMatch(/label/);
    expect(validateQuestions([{ id: "a", label: "L", kind: "text" }, { id: "a", label: "M", kind: "text" }])).toMatch(/duplicate/);
  });
  it("rejects flag_if_yes on text questions and unknown fields", () => {
    expect(validateQuestions([{ id: "a", label: "L", kind: "text", flag_if_yes: true }])).toMatch(/flag_if_yes/);
    expect(validateQuestions([{ id: "a", label: "L", kind: "text", bogus: 1 }])).toMatch(/unknown/);
  });
});

describe("validateAnswers", () => {
  it("accepts complete answers and empty config", () => {
    expect(validateAnswers(QS, { q1: "raw files", q2: true, q3: false })).toBeNull();
    expect(validateAnswers([], {})).toBeNull();
  });
  it("text answers are optional; yes_no answers are required", () => {
    expect(validateAnswers(QS, { q2: true, q3: false })).toBeNull();
    expect(validateAnswers(QS, { q2: true })).toMatch(/FAT32/);
    expect(validateAnswers(QS, {})).toMatch(/wiped/);
  });
  it("rejects unknown keys and wrong types", () => {
    expect(validateAnswers(QS, { q2: true, q3: false, zz: "x" })).toMatch(/unknown/);
    expect(validateAnswers(QS, { q1: 5 as unknown as string, q2: true, q3: false })).toMatch(/text/);
    expect(validateAnswers(QS, { q1: "x".repeat(501), q2: true, q3: false })).toMatch(/500/);
    expect(validateAnswers(QS, { q2: "yes" as unknown as boolean, q3: false })).toMatch(/wiped/);
  });
});

describe("computeFlagged", () => {
  it("flags only when a flag_if_yes question is answered true", () => {
    expect(computeFlagged(QS, { q2: true, q3: false })).toBe(true);
    expect(computeFlagged(QS, { q2: false, q3: true })).toBe(false);
    expect(computeFlagged([], {})).toBe(false);
  });
});

describe("renderAnswers", () => {
  it("pairs answers with current labels, skipping deleted questions and empty text", () => {
    expect(renderAnswers(QS, { q1: "raw files", q2: true, gone: "old" })).toEqual([
      { label: "What is on the card?", value: "raw files" },
      { label: "Important — must not be wiped?", value: true },
    ]);
    expect(renderAnswers(QS, { q1: "", q2: false })).toEqual([
      { label: "Important — must not be wiped?", value: false },
    ]);
    expect(renderAnswers(null, null)).toEqual([]);
  });
});

describe("validateDraftAnswers", () => {
  it("allows partial answers", () => {
    expect(validateDraftAnswers(QS, {})).toBeNull();
    expect(validateDraftAnswers(QS, { q1: "raw files" })).toBeNull();
    expect(validateDraftAnswers(QS, { q2: true })).toBeNull();
  });
  it("rejects unknown keys and wrong types", () => {
    expect(validateDraftAnswers(QS, { zz: true })).toMatch(/unknown/);
    expect(validateDraftAnswers(QS, { q2: "yes" as unknown as boolean })).toMatch(/yes or no/);
    expect(validateDraftAnswers(QS, { q1: "x".repeat(501) })).toMatch(/500/);
  });
});
