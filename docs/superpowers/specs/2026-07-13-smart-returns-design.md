# Smart Returns: per-type return questionnaire + admin attention queue

**Date:** 2026-07-13
**Status:** Approved

## Problem

Rack's return flow is a single confirm (plus the damage checkbox added in
migration 008). For media-bearing items like SD cards, admins need to know
what's on a returned card and whether it must not be wiped before the card
circulates again. Today damage reports are email-only — there is no persisted
place where flagged returns wait for an admin to act on them.

## Scope

In scope:

- **Per-item-type return questionnaire** — admins configure questions per item
  type (e.g., SD card: "What's on this card?" free text; "Important — must not
  be wiped?" yes/no). Users answer them when returning.
- **Admin attention queue** — flagged and damaged returns persist in a queue
  until an admin resolves them.
- **Damage reporting folded into the queue** — the existing damage flow
  (`return_damaged`/`return_note`, admin email, unit → `needs_repair`) gains a
  queue entry instead of being email-only.

Out of scope: kit/accessory checklists.

## Decisions

- **Config model:** admin-configurable questions per item type, not hardcoded
  presets.
- **Flag behavior:** a flagged return ("important contents — don't wipe") does
  **not** hold the unit. It stays borrowable; the flag lands in the admin
  queue, and the next borrower sees a warning at checkout.
- **Storage:** JSONB columns on existing tables, not normalized tables — fits
  the size of this internal tool.
- **Flag computation:** the server derives `flagged` from the answers and the
  type's question config; the client never sends the flag.

## Data model

New migration `db/migrations/009_return_questionnaire.sql`:

- `alter table item_types add column return_questions jsonb not null default '[]'::jsonb`
  — an ordered array of `{ id: string, label: string, kind: 'text' | 'yes_no',
  flag_if_yes?: true }`. IDs are short random strings minted client-side when
  an admin adds a question, so stored answers stay linked if labels are edited.
- `alter table borrow_sessions add column`:
  - `return_answers jsonb` — null when no questionnaire was answered
  - `return_flagged boolean not null default false`
  - `attention_resolved_at timestamptz`
  - `attention_resolved_by uuid references profiles(id)`
- Replace `mark_returned` using the 008 pattern (drop old signature,
  recreate) with two new params: `p_answers jsonb default null,
  p_flagged boolean default false`. Style follows
  `db/migrations/003_functions.sql` / `008_damage_reports.sql` (`p_`/`v_`
  prefixes, `for update` lock, `raise exception ... using errcode`).
  Flagged does NOT change unit status; damaged still sets `needs_repair`.
- **The attention queue is a query, not a table:** sessions where
  `(return_flagged or return_damaged) and attention_resolved_at is null`.

## API

In `api/src/routes/borrow.ts` and `api/src/routes/admin.ts` (all admin routes
behind the existing `requireAdmin` preHandler):

- `POST /api/return` — accepts
  `answers?: Record<questionId, string | boolean>`. The handler loads the
  unit's item type `return_questions` and validates: answer keys must match
  current question IDs (unknown keys → 400), `text` answers are strings
  ≤500 chars, `yes_no` answers are booleans, and every `yes_no` question must
  be answered when the type has questions. The server computes `flagged` (any
  `flag_if_yes` question answered true) and passes answers + flag to
  `mark_returned`. Flagged returns email admins best-effort, reusing the
  `notifyAdminsOfDamage` pattern.
- `GET /api/admin/attention` — open queue items: session id, item type name,
  unit asset_id/status, borrower name/email, returned_at, `return_flagged`,
  `return_damaged`, `return_note`, `return_answers`, plus the type's
  `return_questions` so answer labels can be rendered.
- `POST /api/admin/attention/:sessionId/resolve` — guarded
  `update ... where attention_resolved_at is null` stamping
  `attention_resolved_at/by`; 404 unknown session, 409 already resolved.
  Resolving does not touch unit status — damaged units are released via the
  existing `PATCH /api/admin/item-units/:id`.
- `GET /api/admin/item-types` includes `return_questions`; `POST` and
  `PATCH /api/admin/item-types` accept it with validation (array ≤10
  questions, labels non-empty ≤200 chars, kind in set, unique ids,
  `flag_if_yes` only on `yes_no`), using the existing `coalesce` update
  pattern.
- `POST /api/borrow` response gains `last_return` — the claimed unit's most
  recent returned session's `{ answers, flagged, damaged, note, returned_at }`
  (null if none) so the borrower sees what the previous borrower reported.
- The my-borrows payload includes the type's `return_questions` per active
  borrow so the return sheet knows what to ask.
- `POST /api/admin/return` is unchanged — admin force-return bypasses the
  questionnaire (no answers, never flagged).

## Frontend

In `web/src`:

- **Types** (`lib/types.ts`): `ReturnQuestion`, `ReturnAnswers`,
  `AttentionItem`; extend `ActiveBorrow`, `AdminItemType`, and the borrow
  response type.
- **API client + hooks** (`lib/api.ts`, `hooks/queries.ts`): `returnItem`
  gains `answers`; new `adminAttention` query and `resolveAttention` mutation
  (cache invalidation via the existing `invalidateBorrowViews` pattern);
  item-type create/update carry `return_questions`.
- **Return sheet** (`screens/MyItemsScreen.tsx`): the type's questions render
  above the existing damage fields. `yes_no` questions are two-button toggles
  and must be answered before submit (extends the existing
  `conditionIncomplete` gating); `text` questions are optional inputs. A type
  with no questions returns exactly as today.
- **Question editor** (`screens/AdminInventoryScreen.tsx`): per item type, an
  editable list — label input, kind select, and a "flag for attention if yes"
  checkbox on yes/no rows; add/remove; saves via PATCH. Follows the
  inline-form pattern of `components/RequestOptions.tsx` and the primitives in
  `components/ui.tsx`.
- **Attention queue** (`screens/AdminOverviewScreen.tsx`): a "Needs attention"
  section at the top with a count; each row shows item + borrower + reason
  chips (flagged / damaged), the rendered answers (question label → answer),
  the damage note, and a Resolve button; damaged rows link to the unit's
  status control (existing `useUpdateUnit`).
- **Borrow confirmation** (Browse and Scan share the borrow mutation): when
  `last_return` is flagged or has answers, show a warning card ("Previous
  borrower reported: …").

## Edge cases

- Questions edited while a borrow is active → the return validates against
  the **current** config.
- Unknown answer keys → 400.
- Flagged + damaged on one return → one queue row showing both reasons.
- Resolve raced twice → the second request gets 409.
- Admin force-return → no questionnaire, never flagged.

## Testing

- **API round-trip** in `scripts/smoke-test.sh`: PATCH an item type with
  questions → borrow → return with answers (one `flag_if_yes` answered true) →
  `GET /api/admin/attention` shows the row with `return_flagged` → resolve →
  queue empty. Also assert invalid answer keys are rejected and admin
  force-return skips the questionnaire.
- **Web unit tests** (vitest): extend `MyItemsScreen.test.tsx` (questions
  render, unanswered yes/no blocks submit, no-questions flow unchanged) and
  `AdminOverviewScreen.test.tsx` (queue renders answers + chips, resolve calls
  the mutation).
- **End-to-end**: run the stack (docker-compose db + api, web dev server),
  configure questions on an "SD card" type as admin, borrow and return as a
  user answering "important" = yes, then verify the admin email, the queue
  entry, resolution, and the warning on the next borrow of that unit.
