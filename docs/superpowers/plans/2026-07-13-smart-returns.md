# Smart Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-item-type return questionnaire (e.g., SD card: contents + "important — don't wipe" flag), a persisted admin attention queue for flagged/damaged returns, and a warning to the next borrower.

**Architecture:** Questions live as a JSONB array on `item_types`; answers and a server-computed flag live on `borrow_sessions` next to the existing damage columns (migration 008). The attention queue is a query (`(return_flagged or return_damaged) and attention_resolved_at is null`), resolution is two columns. Flagged returns do NOT change unit status. Spec: `docs/superpowers/specs/2026-07-13-smart-returns-design.md`.

**Tech Stack:** Fastify + `pg` (raw SQL, plpgsql functions), Postgres via docker compose, React + TanStack Query + Tailwind, vitest in both `api/` and `web/`.

## Global Constraints

- Migration file is `db/migrations/010_return_questionnaire.sql` (009 is taken by `009_unconfirmed_borrows.sql`; the spec's "009" is stale).
- Question shape everywhere: `{ id: string, label: string, kind: "text" | "yes_no", flag_if_yes?: true }`. Limits: ≤10 questions/type, label 1–200 chars, text answers ≤500 chars.
- The server computes `flagged`; the client never sends it.
- `answers` in API payloads/DB is `Record<questionId, string | boolean>`. Rendered for display as `AnswerPair = { label, value }` pairs (server-side, so clients never join ids to labels).
- Admin force-return (`POST /api/admin/return`) bypasses the questionnaire entirely — do not touch that handler.
- All admin routes are already behind the `requireAdmin` preHandler hook in `api/src/routes/admin.ts:7`.
- ESM note: `api/src` imports use `.js` suffixes (`import ... from "../questionnaire.js"`).
- Commit after every task. Do not commit unrelated pre-existing dirty files — `git add` only the paths named in the task.

### Dev-stack prerequisite (needed from Task 1 on)

The migration and smoke test run against the local stack. Fresh setup (from repo root; docker via OrbStack — `~/.orbstack/bin` on PATH):

```bash
docker compose up -d db
(cd api && npm run migrate -- --seed) && npx tsx scripts/seed-dev-users.ts
deno run --allow-net --allow-env scripts/mock-seam.ts 9911 &
SEAM_API_URL=http://127.0.0.1:9911 RESEND_API_URL=http://127.0.0.1:9911 \
  NODE_ENV=development npm --prefix api run dev &
```

`scripts/smoke-test.sh` assumes a **fresh seed** (it asserts "28 item types" and creates a `Smoke SD card` type). To re-run it, reset: `docker compose down -v db && docker compose up -d db && (cd api && npm run migrate -- --seed) && npx tsx scripts/seed-dev-users.ts`, then restart the api.

---

### Task 1: Migration 010 — schema, view, `mark_returned`

**Files:**
- Create: `db/migrations/010_return_questionnaire.sql`
- Modify: `docs/superpowers/specs/2026-07-13-smart-returns-design.md` (two stale details)

**Interfaces:**
- Produces: `item_types.return_questions jsonb`, `borrow_sessions.return_answers/return_flagged/attention_resolved_at/attention_resolved_by`, `active_borrows.return_questions` (view column), and `mark_returned(p_session_id uuid, p_user_id uuid, p_is_admin boolean, p_damaged boolean, p_note text, p_answers jsonb, p_flagged boolean)`. Existing 3-arg call `mark_returned($1, $2, true)` in `api/src/routes/admin.ts:26` keeps working via defaults.

- [ ] **Step 1: Write the migration**

Create `db/migrations/010_return_questionnaire.sql`:

```sql
-- Per-item-type return questionnaire + admin attention queue.
-- Questions: [{ "id": "q1", "label": "…", "kind": "text" | "yes_no", "flag_if_yes": true }]
-- A flagged return does NOT hold the unit — it stays borrowable; the flag
-- lands in the attention queue (a query, not a table) until an admin
-- resolves it. Damaged still parks the unit in needs_repair (008).

alter table public.item_types
  add column return_questions jsonb not null default '[]'::jsonb;

alter table public.borrow_sessions add column return_answers jsonb;
alter table public.borrow_sessions add column return_flagged boolean not null default false;
alter table public.borrow_sessions add column attention_resolved_at timestamptz;
alter table public.borrow_sessions add column attention_resolved_by uuid references public.profiles(id);

-- Column appended so the view stays replaceable in place (009 pattern):
-- the return sheet needs the type's questions alongside each active borrow.
create or replace view public.active_borrows
as
select
  s.id as session_id,
  s.user_id,
  p.email,
  p.full_name,
  u.id as item_unit_id,
  u.asset_id,
  t.name as item_name,
  t.category,
  s.checked_out_at,
  s.due_at,
  (s.due_at < now()) as is_overdue,
  (s.unit_confirmed_at is not null or u.asset_id is null) as unit_confirmed,
  t.return_questions
from public.borrow_sessions s
join public.profiles p on p.id = s.user_id
join public.item_units u on u.id = s.item_unit_id
join public.item_types t on t.id = u.item_type_id
where s.status = 'active';

-- Replace mark_returned with questionnaire parameters. Dropped first because
-- adding defaulted parameters would otherwise create a second overload.
drop function public.mark_returned(uuid, uuid, boolean, boolean, text);

create function public.mark_returned(
  p_session_id uuid, p_user_id uuid, p_is_admin boolean,
  p_damaged boolean default false, p_note text default null,
  p_answers jsonb default null, p_flagged boolean default false)
returns void language plpgsql as $$
declare v_session public.borrow_sessions;
begin
  select * into v_session from public.borrow_sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.user_id <> p_user_id and not p_is_admin then
    raise exception 'not allowed to return this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active' then raise exception 'session is not active' using errcode = 'P0001'; end if;
  update public.borrow_sessions
  set status = 'returned', returned_at = now(),
      return_damaged = coalesce(p_damaged, false), return_note = p_note,
      return_answers = p_answers, return_flagged = coalesce(p_flagged, false)
  where id = p_session_id;
  update public.item_units
  set status = case when coalesce(p_damaged, false)
                    then 'needs_repair'::public.unit_status
                    else 'available'::public.unit_status end
  where id = v_session.item_unit_id;
end; $$;
```

- [ ] **Step 2: Run the migration**

Run: `(cd api && npm run migrate)`
Expected: output lists `010_return_questionnaire.sql` as applied, no error.

- [ ] **Step 3: Verify schema**

Run:
```bash
docker compose exec -T db psql -U rack rack -tA -c \
  "select column_name from information_schema.columns where table_name='borrow_sessions' and column_name like 'return_%' or column_name like 'attention_%' order by 1;"
docker compose exec -T db psql -U rack rack -tA -c \
  "select pg_get_function_identity_arguments(oid) from pg_proc where proname='mark_returned';"
```
Expected: columns `attention_resolved_at, attention_resolved_by, return_answers, return_damaged, return_flagged, return_note`; one `mark_returned` row with 7 parameters ending `p_answers jsonb, p_flagged boolean`.

- [ ] **Step 4: Fix the two stale spec details**

In `docs/superpowers/specs/2026-07-13-smart-returns-design.md`: replace both occurrences of `009_return_questionnaire.sql` with `010_return_questionnaire.sql` (add a parenthetical "(009 was taken by an in-flight migration)"), and in the API section change "plus the type's `return_questions` so answer labels can be rendered" to "with answers rendered server-side as `{ label, value }` pairs against the current question config".

- [ ] **Step 5: Commit**

```bash
git add db/migrations/010_return_questionnaire.sql docs/superpowers/specs/2026-07-13-smart-returns-design.md
git commit -m "feat(db): return questionnaire columns, attention queue fields, mark_returned v3"
```

---

### Task 2: Questionnaire helpers (pure, TDD)

**Files:**
- Create: `api/src/questionnaire.ts`
- Test: `api/src/questionnaire.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3–6):
  - `type ReturnQuestion = { id: string; label: string; kind: "text" | "yes_no"; flag_if_yes?: boolean }`
  - `type ReturnAnswers = Record<string, string | boolean>`
  - `type AnswerPair = { label: string; value: string | boolean }`
  - `validateQuestions(input: unknown): string | null` — error message or null
  - `validateAnswers(questions: ReturnQuestion[], answers: ReturnAnswers): string | null`
  - `computeFlagged(questions: ReturnQuestion[], answers: ReturnAnswers): boolean`
  - `renderAnswers(questions: ReturnQuestion[] | null, answers: ReturnAnswers | null): AnswerPair[]`

- [ ] **Step 1: Write the failing tests**

Create `api/src/questionnaire.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateQuestions, validateAnswers, computeFlagged, renderAnswers,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix api test -- src/questionnaire.test.ts`
Expected: FAIL — cannot resolve `./questionnaire.js`.

- [ ] **Step 3: Implement**

Create `api/src/questionnaire.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix api test -- src/questionnaire.test.ts`
Expected: PASS (all 4 describes).

- [ ] **Step 5: Commit**

```bash
git add api/src/questionnaire.ts api/src/questionnaire.test.ts
git commit -m "feat(api): questionnaire validation/render helpers"
```

---

### Task 3: Admin item-types carry `return_questions`

**Files:**
- Modify: `api/src/routes/admin.ts` (GET list ~line 52, POST ~line 64, PATCH ~line 74)
- Modify: `scripts/smoke-test.sh` (append new section before the `== Results` line)

**Interfaces:**
- Consumes: `validateQuestions` from `api/src/questionnaire.js` (Task 2).
- Produces: `GET /api/admin/item-types` rows include `return_questions: ReturnQuestion[]`; `POST`/`PATCH /api/admin/item-types[/:id]` accept optional `return_questions` (400 with the validator's message on bad config).

- [ ] **Step 1: Add the failing smoke checks**

In `scripts/smoke-test.sh`, insert immediately before the final `echo; echo "== Results: …"` line:

```bash
echo "== Return questionnaire config"
SDT=$(curl -sb "$AJ" "$API/api/admin/item-types" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke SD card","category":"Storage","return_questions":[{"id":"q_contents","label":"What is on the card?","kind":"text"},{"id":"q_keep","label":"Important - must not be wiped?","kind":"yes_no","flag_if_yes":true}]}' | jqv id)
check "type created with questions" "yes" "$([ -n "$SDT" ] && echo yes || echo no)"
check "questions echoed on list" "2" "$(curl -sb "$AJ" "$API/api/admin/item-types" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).find(x=>x.name==="Smoke SD card");console.log(t?t.return_questions.length:"")})')"
check "bad question config rejected" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AJ" "$API/api/admin/item-types" -H 'Content-Type: application/json' -d '{"name":"Bad","category":"X","return_questions":[{"id":"a","label":"L","kind":"nope"}]}')"
```

- [ ] **Step 2: Run the smoke test to verify the new checks fail**

Run: `./scripts/smoke-test.sh` (stack running per prerequisite)
Expected: pre-existing checks pass; "type created with questions" FAILs (column exists but POST ignores the field → created without questions; the list check gets 0).

*(Note: if the earlier sections fail because the DB isn't freshly seeded, reset per the prerequisite first.)*

- [ ] **Step 3: Implement the three route changes**

In `api/src/routes/admin.ts`, add the import:

```ts
import { validateQuestions } from "../questionnaire.js";
```

GET list — add `t.return_questions,` to the select (grouped by `t.id`, so no GROUP BY change):

```ts
    const { rows } = await query(`
      select t.id, t.name, t.category, t.notes, t.return_questions,
        coalesce(json_agg(json_build_object(
          'id', u.id, 'asset_id', u.asset_id, 'status', u.status,
          'owner', u.owner, 'notes', u.notes) order by u.created_at)
          filter (where u.id is not null), '[]') as units
      from item_types t left join item_units u on u.item_type_id = t.id
      group by t.id order by t.category, t.name`);
```

POST — replace the handler body:

```ts
  app.post<{ Body: { name?: string; category?: string; notes?: string; return_questions?: unknown } }>(
    "/api/admin/item-types", async (req, reply) => {
      const { name, category, notes, return_questions } = req.body ?? {};
      if (!name || !category) return reply.code(400).send({ error: "name and category are required" });
      if (return_questions !== undefined) {
        const err = validateQuestions(return_questions);
        if (err) return reply.code(400).send({ error: err });
      }
      const { rows } = await query(
        `insert into item_types (name, category, notes, return_questions) values ($1, $2, $3, $4) returning *`,
        [name, category, notes ?? null, JSON.stringify(return_questions ?? [])]);
      return rows[0];
    });
```

PATCH — replace the handler:

```ts
  app.patch<{ Params: { id: string };
    Body: { name?: string; category?: string; notes?: string; return_questions?: unknown } }>(
    "/api/admin/item-types/:id", async (req, reply) => {
      const { return_questions } = req.body ?? {};
      if (return_questions !== undefined) {
        const err = validateQuestions(return_questions);
        if (err) return reply.code(400).send({ error: err });
      }
      const { rows } = await query(`
        update item_types set
          name = coalesce($2, name), category = coalesce($3, category),
          notes = coalesce($4, notes),
          return_questions = coalesce($5::jsonb, return_questions)
        where id = $1 returning *`,
        [req.params.id, req.body?.name ?? null, req.body?.category ?? null, req.body?.notes ?? null,
         return_questions === undefined ? null : JSON.stringify(return_questions)]);
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      return rows[0];
    });
```

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `./scripts/smoke-test.sh` (after a fresh reseed per the prerequisite — the previous run already created a `Smoke SD card` row)
Expected: all checks pass, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/admin.ts scripts/smoke-test.sh
git commit -m "feat(api): admin item-types carry return_questions config"
```

---

### Task 4: `POST /api/return` accepts answers; flagged email; my-borrows carries questions

**Files:**
- Modify: `api/src/routes/borrow.ts` (admin-notify helpers at top; `/api/return` handler ~line 139)
- Modify: `api/src/routes/catalog.ts:26-29` (my-borrows select)
- Modify: `scripts/smoke-test.sh` (extend the Task 3 section)

**Interfaces:**
- Consumes: `validateAnswers`, `computeFlagged`, `renderAnswers`, types from `api/src/questionnaire.js`; `mark_returned(...7 args)` from Task 1.
- Produces: `POST /api/return` body gains `answers?: ReturnAnswers`; response gains `flagged: boolean`. `GET /api/my-borrows` active rows gain `return_questions: ReturnQuestion[]`.

- [ ] **Step 1: Add the failing smoke checks**

In `scripts/smoke-test.sh`, extend the `== Return questionnaire config` section (after the three Task 3 checks, still before `== Results`):

```bash
curl -sb "$AJ" "$API/api/admin/item-units" -H 'Content-Type: application/json' \
  -d "{\"item_type_id\":\"$SDT\"}" >/dev/null
B4=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$SDT\"}")
S4=$(echo "$B4" | jqv session_id)
check "my-borrows carries questions" "2" "$(curl -sb "$UJ" "$API/api/my-borrows" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).active.find(b=>b.item_name==="Smoke SD card");console.log(a?a.return_questions.length:"")})')"
check "return without yes/no answer is 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S4\"}")"
check "unknown answer key is 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S4\",\"answers\":{\"zz\":true,\"q_keep\":true}}")"
RET4=$(curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$S4\",\"answers\":{\"q_contents\":\"client shoot raw files\",\"q_keep\":true}}")
check "flagged return succeeds" "returned" "$(echo "$RET4" | jqv status)"
check "return reports flagged" "true" "$(echo "$RET4" | jqv flagged)"
check "flagged unit stays available" "available" "$(sql "select u.status from item_units u join borrow_sessions s on s.item_unit_id = u.id where s.id = '$S4';")"
check "answers stored" "true" "$(sql "select (return_answers->>'q_keep') from borrow_sessions where id = '$S4';")"
```

- [ ] **Step 2: Run smoke test to verify the new checks fail**

Run: `./scripts/smoke-test.sh` (fresh seed)
Expected: "my-borrows carries questions" FAILs (empty), "return without yes/no answer is 400" FAILs (got 200 — no validation yet), etc.

- [ ] **Step 3: Refactor the admin-notify helper and add the flag email**

In `api/src/routes/borrow.ts`, replace `notifyAdminsOfDamage` (lines 8–31) with:

```ts
import { validateAnswers, computeFlagged, renderAnswers,
  type ReturnQuestion, type ReturnAnswers, type AnswerPair } from "../questionnaire.js";

// Best-effort admin broadcast — the return itself must not fail on email trouble.
async function emailAdmins(subject: string, html: string) {
  try {
    const { rows: admins } = await query(`select email from profiles where role = 'admin'`);
    for (const a of admins) {
      const result = await sendEmail({ to: a.email, subject, html });
      if (!result.ok) console.error("admin email failed for", a.email);
    }
  } catch (err) {
    console.error("admin notification failed", err);
  }
}

async function itemLabelForSession(sessionId: string) {
  const { rows: [item] } = await query(`
    select t.name, u.asset_id from borrow_sessions s
    join item_units u on u.id = s.item_unit_id
    join item_types t on t.id = u.item_type_id where s.id = $1`, [sessionId]);
  return item ? `${item.name}${item.asset_id ? ` (${item.asset_id})` : ""}` : "an item";
}

// Damaged return: tell every admin what came back broken and who reported it.
async function notifyAdminsOfDamage(sessionId: string, note: string, reporter: { email: string; full_name: string | null }) {
  const label = await itemLabelForSession(sessionId);
  await emailAdmins(`Rack: damage reported on ${label}`,
    `<p>${esc(reporter.full_name ?? reporter.email)} returned <strong>${esc(label)}</strong> and reported damage:</p>
<blockquote>${esc(note)}</blockquote>
<p>The unit has been set to <strong>needs repair</strong> and won't be borrowable until an admin clears it.</p><p>— Rack</p>`);
}

// Flagged return (e.g. "important contents — don't wipe"): the unit stays
// borrowable, so admins need to act before the next borrower wipes it.
async function notifyAdminsOfFlag(sessionId: string, pairs: AnswerPair[], reporter: { email: string; full_name: string | null }) {
  const label = await itemLabelForSession(sessionId);
  const fmtVal = (v: string | boolean) => (v === true ? "yes" : v === false ? "no" : v);
  const list = pairs.map((p) => `<li>${esc(p.label)} <strong>${esc(String(fmtVal(p.value)))}</strong></li>`).join("");
  await emailAdmins(`Rack: return flagged for attention — ${label}`,
    `<p>${esc(reporter.full_name ?? reporter.email)} returned <strong>${esc(label)}</strong> with answers that need attention:</p>
<ul>${list}</ul>
<p>The unit is still borrowable — review it in the admin attention queue before someone takes it.</p><p>— Rack</p>`);
}
```

The old function wrapped everything in try/catch so a DB or email failure never failed the return. Preserve that guarantee: wrap the body of **both** `notifyAdminsOfDamage` and `notifyAdminsOfFlag` in `try { … } catch (err) { console.error("return notification failed for session", sessionId, err); }` (their `itemLabelForSession` query can throw; `emailAdmins` already guards its own work). Place the `questionnaire.js` import with the file's other imports at the top.

- [ ] **Step 4: Implement the `/api/return` changes**

In the `/api/return` handler (`borrow.ts` ~line 139):

1. Extend the body type:
```ts
  app.post<{ Body: { session_id?: string; asset_id?: string; damaged?: boolean; note?: string;
    answers?: ReturnAnswers } }>(
```
2. After the existing `note` validation, add:
```ts
      const { answers } = req.body ?? {};
      if (answers !== undefined && (typeof answers !== "object" || answers === null || Array.isArray(answers)))
        return reply.code(400).send({ error: "answers must be an object" });
```
(Adjust the destructure on the first line of the handler to include `answers` instead if you prefer — one destructure total.)
3. Join `item_types` in the session query so the current questions come along:
```ts
      const { rows } = await query(
        `select s.id, s.status, s.item_unit_id, s.user_id, u.asset_id, t.return_questions
         from borrow_sessions s
         join item_units u on u.id = s.item_unit_id
         join item_types t on t.id = u.item_type_id
         where s.id = $1`, [session_id]);
```
4. **Before** the `lockForUnit` call (validation must fail before the cabinet unlocks), after the scan-back check:
```ts
      const questions: ReturnQuestion[] = session.return_questions ?? [];
      const ans: ReturnAnswers = answers ?? {};
      const answerErr = validateAnswers(questions, ans);
      if (answerErr) return reply.code(400).send({ error: answerErr });
      const flagged = computeFlagged(questions, ans);
```
5. Extend the `mark_returned` call:
```ts
        await query(`select mark_returned($1, $2, $3, $4, $5, $6, $7)`,
          [session.id, req.user!.id, req.user!.role === "admin",
           damaged ?? false, note?.trim() || null,
           Object.keys(ans).length ? JSON.stringify(ans) : null, flagged]);
```
6. After the existing damage/availability branch (leave that branch untouched — a flagged-but-undamaged return still frees the unit, so `processItemAvailability` must keep running in the `else`), add:
```ts
      if (flagged) {
        await notifyAdminsOfFlag(session.id, renderAnswers(questions, ans), req.user!);
      }
```
7. Extend the response:
```ts
      return { session_id: session.id, status: "returned", damaged: damaged ?? false, flagged };
```

- [ ] **Step 5: Carry questions on my-borrows**

In `api/src/routes/catalog.ts`, the active query (line 28) — add the view's new column:

```ts
      select session_id, item_name, category, asset_id, checked_out_at, due_at, is_overdue,
             unit_confirmed, return_questions
      from active_borrows where user_id = $1 order by due_at
```

- [ ] **Step 6: Run smoke test to verify it passes**

Run: `./scripts/smoke-test.sh` (fresh seed)
Expected: all checks pass, including the eight new ones. Also eyeball the mock-seam/resend log: a "return flagged for attention" email fired.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/borrow.ts api/src/routes/catalog.ts scripts/smoke-test.sh
git commit -m "feat(api): return questionnaire answers, server-computed flag, admin flag email"
```

---

### Task 5: Attention queue endpoints

**Files:**
- Modify: `api/src/routes/admin.ts`
- Modify: `scripts/smoke-test.sh`

**Interfaces:**
- Consumes: `renderAnswers` from `api/src/questionnaire.js`; columns from Task 1.
- Produces:
  - `GET /api/admin/attention` → `Array<{ session_id, item_name, asset_id, item_unit_id, unit_status, email, full_name, returned_at, return_flagged, return_damaged, return_note, answers: AnswerPair[] }>` (open items, newest first)
  - `POST /api/admin/attention/:id/resolve` → `{ session_id, resolved: true }`; 404 if the session isn't a queue item, 409 if already resolved.

- [ ] **Step 1: Add the failing smoke checks**

Append to the smoke section (after Task 4's checks):

```bash
ATT=$(curl -sb "$AJ" "$API/api/admin/attention")
check "attention queue has 1" "1" "$(echo "$ATT" | jqv '')"
check "attention row is flagged" "true" "$(echo "$ATT" | jqv 0.return_flagged)"
check "attention answers rendered" "2" "$(echo "$ATT" | jqv 0.answers)"
check "resolve succeeds" "true" "$(curl -sb "$AJ" -X POST "$API/api/admin/attention/$S4/resolve" | jqv resolved)"
check "resolve again is 409" "409" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AJ" -X POST "$API/api/admin/attention/$S4/resolve")"
check "attention queue empty after resolve" "0" "$(curl -sb "$AJ" "$API/api/admin/attention" | jqv '')"
```

- [ ] **Step 2: Run smoke test to verify the new checks fail**

Run: `./scripts/smoke-test.sh` (fresh seed)
Expected: new checks FAIL (404 route not found → jqv prints empty).

- [ ] **Step 3: Implement the two endpoints**

In `api/src/routes/admin.ts`, add imports and, after the `/api/admin/return` handler, the routes:

```ts
import { renderAnswers, type ReturnQuestion, type ReturnAnswers } from "../questionnaire.js";
```

```ts
  // Returns needing follow-up: flagged contents ("don't wipe") or damage.
  // The queue is a query — resolution just stamps the session.
  app.get("/api/admin/attention", async () => {
    const { rows } = await query(`
      select s.id as session_id, t.name as item_name, u.asset_id, u.id as item_unit_id,
             u.status as unit_status, p.email, p.full_name, s.returned_at,
             s.return_flagged, s.return_damaged, s.return_note,
             s.return_answers, t.return_questions
      from borrow_sessions s
      join item_units u on u.id = s.item_unit_id
      join item_types t on t.id = u.item_type_id
      join profiles p on p.id = s.user_id
      where (s.return_flagged or s.return_damaged) and s.attention_resolved_at is null
      order by s.returned_at desc`);
    return rows.map(({ return_answers, return_questions, ...r }) => ({
      ...r,
      answers: renderAnswers(return_questions as ReturnQuestion[], return_answers as ReturnAnswers | null),
    }));
  });

  app.post<{ Params: { id: string } }>("/api/admin/attention/:id/resolve", async (req, reply) => {
    const { rows } = await query(`
      update borrow_sessions
      set attention_resolved_at = now(), attention_resolved_by = $2
      where id = $1 and (return_flagged or return_damaged) and attention_resolved_at is null
      returning id`, [req.params.id, req.user!.id]);
    if (rows[0]) return { session_id: rows[0].id, resolved: true };
    const open = await query(
      `select 1 from borrow_sessions where id = $1 and (return_flagged or return_damaged)`,
      [req.params.id]);
    if (!open.rows[0]) return reply.code(404).send({ error: "not found" });
    return reply.code(409).send({ error: "already resolved" });
  });
```

- [ ] **Step 4: Run smoke test to verify it passes**

Run: `./scripts/smoke-test.sh` (fresh seed)
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/admin.ts scripts/smoke-test.sh
git commit -m "feat(api): admin attention queue — list + resolve"
```

---

### Task 6: `POST /api/borrow` returns `last_return`

**Files:**
- Modify: `api/src/routes/borrow.ts` (`/api/borrow` handler, ~lines 53–95)
- Modify: `scripts/smoke-test.sh`

**Interfaces:**
- Consumes: `renderAnswers` (already imported in Task 4).
- Produces: borrow response gains `last_return: { flagged: boolean, damaged: boolean, note: string | null, returned_at: string, answers: AnswerPair[] } | null` — null when the unit has never been returned or the last return was clean with no answers.

- [ ] **Step 1: Add the failing smoke checks**

Append to the smoke section:

```bash
B5=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$SDT\"}")
check "borrow warns about last return" "true" "$(echo "$B5" | jqv last_return.flagged)"
check "warning carries answers" "2" "$(echo "$B5" | jqv last_return.answers)"
S5=$(echo "$B5" | jqv session_id)
check "admin return skips questionnaire" "returned" "$(curl -sb "$AJ" "$API/api/admin/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S5\"}" | jqv status)"
```

- [ ] **Step 2: Run smoke test to verify the new checks fail**

Run: `./scripts/smoke-test.sh` (fresh seed)
Expected: "borrow warns about last return" FAILs (empty — field absent).

- [ ] **Step 3: Implement**

In the `/api/borrow` handler, after the `borrow_unit` call succeeds and before `const lock = await lockForUnit(...)`:

```ts
      // Surface the previous borrower's return report on this exact unit —
      // e.g. "important contents, don't wipe" — before the user opens the door.
      const { rows: [prev] } = await query(`
        select s.return_answers, s.return_flagged, s.return_damaged, s.return_note,
               s.returned_at, t.return_questions
        from borrow_sessions s
        join item_units u on u.id = s.item_unit_id
        join item_types t on t.id = u.item_type_id
        where s.item_unit_id = $1 and s.status = 'returned'
        order by s.returned_at desc limit 1`, [session.item_unit_id]);
      const prevAnswers = prev ? renderAnswers(prev.return_questions, prev.return_answers) : [];
      const last_return = prev && (prev.return_flagged || prev.return_damaged || prevAnswers.length)
        ? { flagged: prev.return_flagged, damaged: prev.return_damaged, note: prev.return_note,
            returned_at: prev.returned_at, answers: prevAnswers }
        : null;
```

Then include it in **both** success returns:

```ts
        return { ...session, unlock: "skipped", last_return };
```
```ts
      return { ...session, unlock: "ok", last_return };
```

- [ ] **Step 4: Run smoke test to verify it passes**

Run: `./scripts/smoke-test.sh` (fresh seed)
Expected: all pass. (The final `admin return skips questionnaire` check proves the bypass: that session has unanswered yes_no questions, yet the admin route returns it.)

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/borrow.ts scripts/smoke-test.sh
git commit -m "feat(api): borrow response carries last_return warning"
```

---

### Task 7: Web types, API client, hooks

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/hooks/queries.ts`
- Test: `web/src/lib/api.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 8–11):
  - types: `ReturnQuestion`, `ReturnAnswers`, `AnswerPair`, `LastReturn`, `AttentionItem`; `ActiveBorrow.return_questions`, `BorrowResult.last_return`, `AdminItemType.return_questions`
  - `api.returnItem({ …, answers? })`, `api.adminAttention()`, `api.resolveAttention(session_id)`, `api.createItemType`/`api.updateItemType` accept `return_questions`
  - hooks: `useAdminAttention()`, `useResolveAttention()`; `useReturn` passes `answers`; `invalidateBorrowViews` also invalidates `["attention"]`

- [ ] **Step 1: Write the failing test**

Append to `web/src/lib/api.test.ts` inside the `describe("api client", …)` block:

```ts
  it("returnItem sends answers and omits absent optionals", async () => {
    const f = mockFetch(200, { session_id: "s1", status: "returned", damaged: false, flagged: true });
    vi.stubGlobal("fetch", f);
    await api.returnItem({ session_id: "s1", answers: { q1: "raw files", q2: true } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/return");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      session_id: "s1", answers: { q1: "raw files", q2: true },
    });
  });

  it("resolveAttention posts to the session's resolve route", async () => {
    const f = mockFetch(200, { session_id: "s9", resolved: true });
    vi.stubGlobal("fetch", f);
    await api.resolveAttention("s9");
    expect(f.mock.calls[0][0]).toBe("/api/admin/attention/s9/resolve");
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- src/lib/api.test.ts`
Expected: FAIL — `answers` not in `returnItem`'s parameter type / `resolveAttention` doesn't exist (TS build error counts as the failure).

- [ ] **Step 3: Implement types**

In `web/src/lib/types.ts` add:

```ts
export interface ReturnQuestion {
  id: string; label: string; kind: "text" | "yes_no"; flag_if_yes?: boolean;
}
export type ReturnAnswers = Record<string, string | boolean>;
export interface AnswerPair { label: string; value: string | boolean; }
export interface LastReturn {
  flagged: boolean; damaged: boolean; note: string | null;
  returned_at: string; answers: AnswerPair[];
}
export interface AttentionItem {
  session_id: string; item_name: string; asset_id: string | null; item_unit_id: string;
  unit_status: UnitStatus; email: string; full_name: string | null; returned_at: string;
  return_flagged: boolean; return_damaged: boolean; return_note: string | null;
  answers: AnswerPair[];
}
```

and extend the existing interfaces:

```ts
export interface ActiveBorrow {
  session_id: string; item_name: string; category: string; asset_id: string | null;
  checked_out_at: string; due_at: string; is_overdue: boolean; unit_confirmed: boolean;
  return_questions: ReturnQuestion[];
}
```
```ts
export interface BorrowResult {
  session_id: string; item_unit_id: string; due_at: string; unlock: "ok" | "skipped";
  last_return: LastReturn | null;
}
```
```ts
export interface AdminItemType {
  id: string; name: string; category: string; notes: string | null;
  return_questions: ReturnQuestion[]; units: AdminUnit[];
}
```

- [ ] **Step 4: Implement the API client**

In `web/src/lib/api.ts`: extend the type import with `AttentionItem, ReturnAnswers, ReturnQuestion`, then:

```ts
  returnItem: (v: { session_id: string; asset_id?: string; damaged?: boolean; note?: string; answers?: ReturnAnswers }) =>
    request<{ session_id: string; status: string; damaged: boolean; flagged: boolean }>("/return", post({
      session_id: v.session_id,
      ...(v.asset_id ? { asset_id: v.asset_id } : {}),
      ...(v.damaged ? { damaged: true, note: v.note } : {}),
      ...(v.answers ? { answers: v.answers } : {}),
    })),
```
```ts
  adminAttention: () => request<AttentionItem[]>("/admin/attention"),
  resolveAttention: (session_id: string) =>
    request<{ session_id: string; resolved: true }>(`/admin/attention/${encodeURIComponent(session_id)}/resolve`, post()),
```
```ts
  createItemType: (body: { name: string; category: string; notes?: string; return_questions?: ReturnQuestion[] }) =>
    request<AdminItemType>("/admin/item-types", post(body)),
  updateItemType: (id: string, body: { name?: string; category?: string; notes?: string; return_questions?: ReturnQuestion[] }) =>
    request<AdminItemType>(`/admin/item-types/${id}`, patch(body)),
```

- [ ] **Step 5: Implement the hooks**

In `web/src/hooks/queries.ts`:

```ts
function invalidateBorrowViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["availability"] });
  qc.invalidateQueries({ queryKey: ["my-borrows"] });
  qc.invalidateQueries({ queryKey: ["admin-borrows"] });
  qc.invalidateQueries({ queryKey: ["attention"] });
}
```
```ts
export const useAdminAttention = () => useQuery({ queryKey: ["attention"], queryFn: api.adminAttention });
export function useResolveAttention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (session_id: string) => api.resolveAttention(session_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attention"] }),
  });
}
```
`useReturn`'s mutationFn type gains `answers?: ReturnAnswers` (import the type):
```ts
    mutationFn: (v: { session_id: string; asset_id?: string; damaged?: boolean; note?: string; answers?: ReturnAnswers }) =>
      api.returnItem(v),
```
`useUpdateItemType`'s body type gains `return_questions?: ReturnQuestion[]`:
```ts
  return useMutation({ mutationFn: (v: { id: string; body: { name?: string; category?: string; notes?: string; return_questions?: ReturnQuestion[] } }) => api.updateItemType(v.id, v.body), onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }) });
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm --prefix web test -- src/lib/api.test.ts` → PASS
Run: `npm --prefix web run build` → compiles clean (screens don't use the new fields yet; `ActiveBorrow.return_questions` being required doesn't break existing screens since none construct an `ActiveBorrow`).

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/src/hooks/queries.ts web/src/lib/api.test.ts
git commit -m "feat(web): smart-returns types, api client, hooks"
```

---

### Task 8: Return sheet asks the questions (MyItemsScreen)

**Files:**
- Modify: `web/src/screens/MyItemsScreen.tsx`
- Test: `web/src/screens/MyItemsScreen.test.tsx`

**Interfaces:**
- Consumes: `ActiveBorrow.return_questions`, `useReturn` with `answers`, `ReturnAnswers` type (Task 7).

- [ ] **Step 1: Write the failing test**

Append to `web/src/screens/MyItemsScreen.test.tsx`:

```tsx
it("asks return questions and blocks until every yes/no is answered", async () => {
  const withQuestions = {
    ...DATA,
    active: [{ ...DATA.active[0], is_overdue: false, return_questions: [
      { id: "q1", label: "What's on the card?", kind: "text" },
      { id: "q2", label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true },
    ] }],
  };
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/api/return"))
      return { ok: true, status: 200, json: async () => ({ session_id: "s1", status: "returned", damaged: false, flagged: true }) };
    if (path.endsWith("/api/my-borrows")) return { ok: true, status: 200, json: async () => withQuestions };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await userEvent.click(await screen.findByRole("button", { name: /more options/i }));
  await userEvent.click(await screen.findByRole("button", { name: "Return" }));
  expect(await screen.findByText("What's on the card?")).toBeInTheDocument();

  const confirm = screen.getByRole("button", { name: /confirm & unlock/i });
  expect(confirm).toBeDisabled(); // q2 unanswered

  await userEvent.type(screen.getByLabelText(/what's on the card/i), "beach shoot raws");
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);

  expect(await screen.findByText("Cabinet unlocked")).toBeInTheDocument();
  const call = f.mock.calls.find(([u]) => String(u).endsWith("/api/return"));
  expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({
    session_id: "s1", answers: { q1: "beach shoot raws", q2: true },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- src/screens/MyItemsScreen.test.tsx`
Expected: new test FAILs at `findByText("What's on the card?")`; the three pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `web/src/screens/MyItemsScreen.tsx`:

1. Import the type: `import type { ActiveBorrow, ItemRequest, ReturnAnswers } from "../lib/types";`
2. Add state next to `damaged`/`note` (line ~80): `const [answers, setAnswers] = useState<ReturnAnswers>({});`
3. Reset it in `open(…)` alongside `setDamaged(false); setNote("");`: add `setAnswers({});`
4. Below `const conditionIncomplete = …` (line 91), add:

```tsx
  const questions = sheet?.b.return_questions ?? [];
  const setAnswer = (id: string, v: string | boolean) => setAnswers((a) => ({ ...a, [id]: v }));
  const questionsIncomplete = questions.some((q) => q.kind === "yes_no" && typeof answers[q.id] !== "boolean");
  const returnIncomplete = conditionIncomplete || questionsIncomplete;

  const questionFields = questions.length > 0 && (
    <div className="mb-3 flex flex-col gap-3">
      {questions.map((q) =>
        q.kind === "yes_no" ? (
          <div key={q.id}>
            <p className="mb-1 text-sm text-gray-700">{q.label}</p>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" onClick={() => setAnswer(q.id, v)}
                  className={`min-h-[44px] flex-1 rounded-xl border ${answers[q.id] === v ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"}`}>
                  {v ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label key={q.id} className="text-sm text-gray-700">
            {q.label}
            <textarea rows={2} maxLength={500} value={(answers[q.id] as string) ?? ""}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-sm focus:border-gray-900 focus:outline-none" />
          </label>
        ))}
    </div>
  );
```

5. In `doReturn`, send trimmed non-empty answers:

```tsx
  const doReturn = (asset_id?: string) => {
    if (!sheet) return;
    const cleanAnswers = Object.fromEntries(
      Object.entries(answers)
        .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v] as const)
        .filter(([, v]) => v !== ""));
    ret.mutate({
      session_id: sheet.b.session_id, asset_id, damaged, note: note.trim() || undefined,
      answers: Object.keys(cleanAnswers).length ? cleanAnswers : undefined,
    }, {
```
(rest of the mutate call unchanged.)

6. In `onDecoded`, widen the guard (line 114): replace `conditionIncomplete` with `returnIncomplete` and the message with `"Answer the return questions first, then scan again."`
7. In the labeled-return branch (line ~289): render `{questionFields}` on the line above `{conditionFields}`, and change the manual-confirm button's `disabled` from `conditionIncomplete` to `returnIncomplete`.
8. In the unlabeled-return branch (line ~306): render `{questionFields}` above `{conditionFields}`, and change the confirm button's `disabled={ret.isPending || conditionIncomplete}` to `disabled={ret.isPending || returnIncomplete}`.
9. In the `done` branch, acknowledge a flagged report (line ~225):

```tsx
            <p className="mb-5 text-sm text-gray-600">
              {damaged
                ? "Put the item back and close the door — the admins have been notified and the unit is marked for repair."
                : ret.data?.flagged
                  ? "Put the item back and close the door — your notes were sent to the admins."
                  : "Put the item back and close the door."}
            </p>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web test -- src/screens/MyItemsScreen.test.tsx`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/MyItemsScreen.tsx web/src/screens/MyItemsScreen.test.tsx
git commit -m "feat(web): return sheet asks per-type questions, gates on yes/no"
```

---

### Task 9: Admin attention queue (AdminOverviewScreen)

**Files:**
- Modify: `web/src/screens/AdminOverviewScreen.tsx`
- Test: `web/src/screens/AdminOverviewScreen.test.tsx`

**Interfaces:**
- Consumes: `useAdminAttention`, `useResolveAttention`, `AttentionItem` (Task 7).

- [ ] **Step 1: Write the failing test**

Append to `web/src/screens/AdminOverviewScreen.test.tsx` (add `userEvent` and `waitFor` imports: `import userEvent from "@testing-library/user-event";` and extend the testing-library import to `{ render, screen, waitFor }`):

```tsx
const ATTN = [{
  session_id: "s9", item_name: "SD card 128GB", asset_id: "RACK-0102", item_unit_id: "u9",
  unit_status: "available", email: "user@rack.local", full_name: "Rack User",
  returned_at: "2026-07-12T00:00:00Z", return_flagged: true, return_damaged: false, return_note: null,
  answers: [
    { label: "What's on the card?", value: "client shoot raw files" },
    { label: "Important — must not be wiped?", value: true },
  ],
}];

it("shows the attention queue and resolves an item", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith("/resolve")) return { ok: true, status: 200, json: async () => ({ session_id: "s9", resolved: true }) };
    if (path.endsWith("/api/admin/attention")) return { ok: true, status: 200, json: async () => ATTN };
    return { ok: true, status: 200, json: async () => DATA };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  expect(await screen.findByText(/needs attention/i)).toBeInTheDocument();
  expect(screen.getByText("Flagged")).toBeInTheDocument();
  expect(screen.getByText("client shoot raw files")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
  await waitFor(() =>
    expect(f.mock.calls.some(([u]) => String(u).endsWith("/api/admin/attention/s9/resolve"))).toBe(true));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- src/screens/AdminOverviewScreen.test.tsx`
Expected: new test FAILs at `findByText(/needs attention/i)`; the pre-existing test still passes (its single-value fetch stub returns `DATA` to the attention query too — an object, so `.length` is undefined and the section stays hidden).

- [ ] **Step 3: Implement**

In `web/src/screens/AdminOverviewScreen.tsx`: extend the hooks import to include `useAdminAttention, useResolveAttention`, then inside the component add:

```tsx
  const attention = useAdminAttention();
  const resolve = useResolveAttention();
```

and render this section immediately after the opening `<div className="py-3">` (above the "Checked out" header block):

```tsx
      {(attention.data?.length ?? 0) > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-lg font-semibold">Needs attention ({attention.data!.length})</h2>
          <ul className="flex flex-col gap-2">
            {attention.data!.map((a) => (
              <li key={a.session_id} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {a.item_name}
                    {a.asset_id ? <span className="font-mono text-xs text-gray-400"> · {a.asset_id}</span> : null}
                  </p>
                  <div className="flex gap-1">
                    {a.return_flagged && <Badge tone="amber">Flagged</Badge>}
                    {a.return_damaged && <Badge tone="red">Damaged</Badge>}
                  </div>
                </div>
                <p className="text-xs text-gray-500">Returned by {a.full_name ?? a.email} · {fmt(a.returned_at)}</p>
                {a.answers.map((p, i) => (
                  <p key={i} className="text-sm text-gray-700">
                    {p.label} <strong>{p.value === true ? "yes" : p.value === false ? "no" : p.value}</strong>
                  </p>
                ))}
                {a.return_note && <p className="text-sm text-red-600">Damage: {a.return_note}</p>}
                <div className="mt-2 flex items-center justify-between">
                  {a.return_damaged
                    ? <Link to="/admin/inventory" className="text-xs text-gray-500 underline">Unit is in repair — manage in inventory</Link>
                    : <span />}
                  <Button variant="secondary" disabled={resolve.isPending}
                    onClick={() => resolve.mutate(a.session_id, {
                      onSuccess: () => toast("Resolved."),
                      onError: (e) => toast(errorMessage(e), "error"),
                    })}>
                    Resolve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web test -- src/screens/AdminOverviewScreen.test.tsx`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/AdminOverviewScreen.tsx web/src/screens/AdminOverviewScreen.test.tsx
git commit -m "feat(web): admin needs-attention queue with resolve"
```

---

### Task 10: Question editor (AdminInventoryScreen)

**Files:**
- Modify: `web/src/screens/AdminInventoryScreen.tsx`
- Test (create): `web/src/screens/AdminInventoryScreen.test.tsx`

**Interfaces:**
- Consumes: `AdminItemType.return_questions`, `useUpdateItemType` with `return_questions` (Task 7).

- [ ] **Step 1: Write the failing test**

Create `web/src/screens/AdminInventoryScreen.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, beforeEach } from "vitest";
import { AdminInventoryScreen } from "./AdminInventoryScreen";
import { ToastProvider } from "../components/ui";

const TYPES = [
  { id: "t1", name: "SD card 128GB", category: "Storage", notes: null, return_questions: [], units: [] },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><ToastProvider><AdminInventoryScreen /></ToastProvider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => vi.restoreAllMocks());

it("adds a return question and saves it on the type", async () => {
  const f = vi.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/api/admin/item-types/t1") && init?.method === "PATCH")
      return { ok: true, status: 200, json: async () => ({ ...TYPES[0] }) };
    if (path.endsWith("/api/admin/item-types")) return { ok: true, status: 200, json: async () => TYPES };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", f);
  wrap();

  await screen.findByText("SD card 128GB");
  await userEvent.click(screen.getByRole("button", { name: /return questions \(0\)/i }));
  await userEvent.type(screen.getByPlaceholderText(/question label/i), "Important — must not be wiped?");
  await userEvent.selectOptions(screen.getByLabelText(/answer type/i), "yes_no");
  await userEvent.click(screen.getByLabelText(/flag for attention if yes/i));
  await userEvent.click(screen.getByRole("button", { name: "Add question" }));
  expect(screen.getByText("Important — must not be wiped?")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save questions" }));

  await waitFor(() => {
    const call = f.mock.calls.find(([u, i]) => String(u).endsWith("/api/admin/item-types/t1") && (i as RequestInit)?.method === "PATCH");
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.return_questions).toHaveLength(1);
    expect(body.return_questions[0]).toMatchObject({
      label: "Important — must not be wiped?", kind: "yes_no", flag_if_yes: true,
    });
    expect(typeof body.return_questions[0].id).toBe("string");
    expect(body.return_questions[0].id.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- src/screens/AdminInventoryScreen.test.tsx`
Expected: FAIL — no "return questions (0)" button.

- [ ] **Step 3: Implement**

In `web/src/screens/AdminInventoryScreen.tsx`:

1. Extend imports: `useUpdateItemType` from hooks; `import type { AdminItemType, ReturnQuestion, UnitStatus } from "../lib/types";`
2. Add the editor component after `UnitHistory`:

```tsx
// Per-type return questionnaire editor. Question ids are minted here (short
// random strings) so stored answers stay linked when labels are edited later.
function ReturnQuestionsEditor({ type }: { type: AdminItemType }) {
  const update = useUpdateItemType();
  const toast = useToast();
  const [draft, setDraft] = useState<ReturnQuestion[]>(type.return_questions);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"text" | "yes_no">("text");
  const [flag, setFlag] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(type.return_questions);

  const add = () => {
    if (!label.trim()) return;
    setDraft([...draft, {
      id: crypto.randomUUID().slice(0, 8), label: label.trim(), kind,
      ...(kind === "yes_no" && flag ? { flag_if_yes: true as const } : {}),
    }]);
    setLabel(""); setKind("text"); setFlag(false);
  };
  const save = () =>
    update.mutate({ id: type.id, body: { return_questions: draft } }, {
      onSuccess: () => toast("Return questions saved."),
      onError: (e) => toast(errorMessage(e), "error"),
    });

  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-2">
      <ul className="flex flex-col gap-1">
        {draft.map((q, i) => (
          <li key={q.id} className="flex items-center justify-between text-sm text-gray-700">
            <span>
              {q.label}
              <span className="ml-1 text-xs text-gray-400">{q.kind === "yes_no" ? "yes/no" : "text"}{q.flag_if_yes ? " · flags" : ""}</span>
            </span>
            <button className="text-xs text-gray-500 underline"
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
        {draft.length === 0 && <li className="text-xs text-gray-400">No return questions yet.</li>}
      </ul>
      <div className="mt-2 flex flex-col gap-2">
        <Input placeholder="Question label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <label className="flex items-center gap-1">
            Answer type
            <select className="rounded-lg border border-gray-300 px-2 py-1" value={kind}
              onChange={(e) => setKind(e.target.value as "text" | "yes_no")}>
              <option value="text">text</option>
              <option value="yes_no">yes/no</option>
            </select>
          </label>
          {kind === "yes_no" && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} />
              Flag for attention if yes
            </label>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={add} disabled={!label.trim()}>Add question</Button>
          <Button onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? "Saving…" : "Save questions"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

3. In `AdminInventoryScreen`, add `const [editQuestions, setEditQuestions] = useState<string | null>(null);` next to `expandedUnit`, and in the type card (below the name/category `<div>` and `+ Unit` button row, before the units `<ul>`) add:

```tsx
            <button className="mb-2 text-xs text-gray-500 underline"
              onClick={() => setEditQuestions(editQuestions === t.id ? null : t.id)}>
              Return questions ({t.return_questions.length})
            </button>
            {editQuestions === t.id && <ReturnQuestionsEditor type={t} />}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web test -- src/screens/AdminInventoryScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/AdminInventoryScreen.tsx web/src/screens/AdminInventoryScreen.test.tsx
git commit -m "feat(web): per-type return-questions editor in admin inventory"
```

---

### Task 11: Warn the next borrower (Browse + Scan)

**Files:**
- Create: `web/src/components/LastReturnNotice.tsx`
- Modify: `web/src/screens/BrowseScreen.tsx`, `web/src/screens/ScanScreen.tsx`
- Test: `web/src/screens/BrowseScreen.test.tsx`

**Interfaces:**
- Consumes: `BorrowResult.last_return`, `LastReturn` type (Tasks 6–7).
- Produces: `<LastReturnNotice lastReturn={result.last_return} />`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/screens/BrowseScreen.test.tsx` inside the describe block:

```tsx
  it("warns about the previous borrower's flagged return after checkout", async () => {
    const f = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith("/api/borrow"))
        return { ok: true, status: 200, json: async () => ({
          session_id: "s1", item_unit_id: "u1", due_at: "2026-07-20T00:00:00Z", unlock: "ok",
          last_return: { flagged: true, damaged: false, note: null, returned_at: "2026-07-12T00:00:00Z",
            answers: [{ label: "Important — must not be wiped?", value: true }] },
        }) };
      if (path.endsWith("/api/availability")) return { ok: true, status: 200, json: async () => AVAIL };
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", f);
    wrap();

    await screen.findByText("GoPro 13 Black");
    await userEvent.click(screen.getByRole("button", { name: "Borrow" }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm & unlock/i }));
    expect(await screen.findByText(/previous borrower flagged/i)).toBeInTheDocument();
    expect(screen.getByText(/must not be wiped/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- src/screens/BrowseScreen.test.tsx`
Expected: new test FAILs at `findByText(/previous borrower flagged/i)`.

- [ ] **Step 3: Implement the component**

Create `web/src/components/LastReturnNotice.tsx`:

```tsx
import type { LastReturn } from "../lib/types";

// Shown right after checkout when the previous borrower's return report
// matters to the next user — flagged contents ("don't wipe") or notes.
export function LastReturnNotice({ lastReturn }: { lastReturn: LastReturn | null | undefined }) {
  if (!lastReturn || (!lastReturn.flagged && lastReturn.answers.length === 0)) return null;
  return (
    <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-left">
      <p className="mb-1 text-sm font-medium text-amber-800">
        {lastReturn.flagged ? "Heads up — the previous borrower flagged this item" : "Previous borrower reported"}
      </p>
      {lastReturn.answers.map((p, i) => (
        <p key={i} className="text-sm text-amber-800">
          {p.label} <strong>{p.value === true ? "yes" : p.value === false ? "no" : p.value}</strong>
        </p>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Render it in both screens**

`web/src/screens/BrowseScreen.tsx`: add `import { LastReturnNotice } from "../components/LastReturnNotice";` and in the `result ? (…)` branch (the post-borrow scan step, line ~104), insert `<LastReturnNotice lastReturn={result.last_return} />` between the heading and the "Take your item…" paragraph. Also add it in the `result && confirmedAsset` branch above the "…is checked out to you" paragraph (the user may confirm the unit before reading it).

`web/src/screens/ScanScreen.tsx`: same import; in the `if (result)` block insert `<LastReturnNotice lastReturn={result.last_return} />` between the `<h2>` and the `<Button>` line's paragraph (after `msg.body`'s `<p>`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix web test -- src/screens/BrowseScreen.test.tsx`
Expected: all 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/LastReturnNotice.tsx web/src/screens/BrowseScreen.tsx web/src/screens/ScanScreen.tsx web/src/screens/BrowseScreen.test.tsx
git commit -m "feat(web): last-return warning after checkout"
```

---

### Task 12: Full verification + docs

**Files:**
- Modify: `README.md` (Architecture bullet list)

- [ ] **Step 1: Run every suite**

```bash
npm --prefix api test           # questionnaire helpers
npm --prefix web test           # all web unit tests
npm --prefix api run build      # tsc clean
npm --prefix web run build      # tsc + vite clean
```
Expected: all pass, both builds clean.

- [ ] **Step 2: Full smoke test against a fresh stack**

Reset and rerun per the prerequisite block, then: `./scripts/smoke-test.sh`
Expected: `== Results: N passed, 0 failed` (N grew by ~17 across Tasks 3–6).

- [ ] **Step 3: Manual end-to-end pass (spec's E2E scenario)**

With the stack and `npm --prefix web run dev` running:
1. As admin (`admin@rack.local` / `password123`): Inventory → add "Return questions" on a type (text "What's on the card?", yes/no "Important — must not be wiped?" with flag).
2. As user: borrow a unit of that type, then return it from My Items — answer the text question, tap Yes; confirm the return blocks until Yes/No is chosen.
3. As admin: Overview shows "Needs attention (1)" with the answers; mock resend log shows the flag email; Resolve clears it.
4. As user: borrow the same type again — the amber "previous borrower flagged" card shows the answers.

- [ ] **Step 4: Document in README**

In `README.md`'s Fastify API bullet list, add after the `/api/requests` bullet:

```markdown
- Item types can define **return questions** (e.g. SD cards: "What's on the
  card?", "Important — must not be wiped?"). Users answer them on return;
  a flagged answer emails admins and lands in the **attention queue**
  (`GET /api/admin/attention`, resolve via
  `POST /api/admin/attention/:id/resolve`) without holding the unit, and the
  next borrower of that exact unit sees the previous report in the borrow
  response (`last_return`).
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: smart returns — questionnaire + attention queue"
```
