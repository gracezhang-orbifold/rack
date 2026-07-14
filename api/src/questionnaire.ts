// Per-item-type return questionnaire: config validation (admin), answer
// validation (borrower), flag derivation, and label/value pairing for display.
// Pure functions — the routes own all DB access.

export type ReturnQuestion = {
  id: string;
  label: string;
  kind: "text" | "yes_no";
  flag_if_yes?: boolean;
};
export type ReturnAnswers = Record<string, string | boolean>;
export type AnswerPair = { label: string; value: string | boolean };

const MAX_QUESTIONS = 10;
const MAX_LABEL = 200;
const MAX_TEXT_ANSWER = 500;

export function validateQuestions(input: unknown): string | null {
  if (!Array.isArray(input)) return "return_questions must be an array";
  if (input.length > MAX_QUESTIONS) return `at most ${MAX_QUESTIONS} return questions per item type`;
  const ids = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "each question must be an object";
    const { id, label, kind, flag_if_yes, ...rest } = raw as Record<string, unknown>;
    const extra = Object.keys(rest);
    if (extra.length) return `unknown question field: ${extra[0]}`;
    if (typeof id !== "string" || !id) return "each question needs a string id";
    if (ids.has(id)) return `duplicate question id: ${id}`;
    ids.add(id);
    if (typeof label !== "string" || !label.trim() || label.length > MAX_LABEL)
      return `question labels must be 1-${MAX_LABEL} characters`;
    if (kind !== "text" && kind !== "yes_no") return "question kind must be text or yes_no";
    if (flag_if_yes !== undefined && (flag_if_yes !== true || kind !== "yes_no"))
      return "flag_if_yes may only be true, on yes_no questions";
  }
  return null;
}

// Text answers are optional; every yes_no question must be answered.
export function validateAnswers(questions: ReturnQuestion[], answers: ReturnAnswers): string | null {
  for (const key of Object.keys(answers)) {
    if (!questions.some((q) => q.id === key)) return `unknown question: ${key}`;
  }
  for (const q of questions) {
    const v = answers[q.id];
    if (q.kind === "yes_no") {
      if (typeof v !== "boolean") return `please answer: ${q.label}`;
    } else if (v !== undefined && (typeof v !== "string" || v.length > MAX_TEXT_ANSWER)) {
      return `answer to "${q.label}" must be text of at most ${MAX_TEXT_ANSWER} characters`;
    }
  }
  return null;
}

export function computeFlagged(questions: ReturnQuestion[], answers: ReturnAnswers): boolean {
  return questions.some((q) => q.kind === "yes_no" && q.flag_if_yes === true && answers[q.id] === true);
}

// Pairs stored answers with the *current* config's labels; answers to
// since-deleted questions and empty text answers are skipped.
export function renderAnswers(
  questions: ReturnQuestion[] | null, answers: ReturnAnswers | null): AnswerPair[] {
  if (!questions || !answers) return [];
  return questions
    .filter((q) => answers[q.id] !== undefined && answers[q.id] !== "")
    .map((q) => ({ label: q.label, value: answers[q.id] }));
}
