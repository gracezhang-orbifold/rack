# Restyle v2: sidebar layout, service requests, pre-answered returns

**Date:** 2026-07-14
**Status:** Approved

## Problem

Iteration feedback on the first restyle: the admin page reads off-center, the
steel-blue action buttons glare in dark mode, some My Items text is too
low-contrast, and the header shifts between pages. The user supplied a
reference layout (Figma community file 1505941376231002571, "Asset Sphere")
whose slides 4+ show a sidebar app with separate admin and employee menus —
copy the menu options, keep Rack's functionality. Two menu items need real
backend support, which the user explicitly authorized.

## Reference menus (copied verbatim)

- **Employee sidebar:** Dashboard · My Assets · Raise New Request · Raise
  Service Request · View Request Status · Log Out, with a name/role chip at
  the sidebar bottom. (Reference's "Upgrade to PRO" promo: omitted.)
- **Admin sidebar:** Dashboard · Total Assets · Assigned Assets · View
  Request · Add Asset · Under Service · Log Out.

Sidebars render at md+; mobile keeps a bottom tab bar (Dashboard, My Assets,
Requests, and Admin for admins) with the remaining pages reachable within.

## Feature 1: service requests (new backend)

- Migration `012_service_requests_and_drafts.sql`:
  `service_requests(id, item_unit_id→item_units, user_id→profiles,
  description text, status 'open'|'resolved' default 'open', created_at,
  resolved_by→profiles, resolved_at)`.
- `POST /api/service-requests` `{ asset_id, description }` — resolves the
  unit by asset id (404 unknown/retired), description required ≤500 chars,
  creates an open request, emails admins best-effort. Any signed-in user.
- `GET /api/service-requests` — caller's own requests (unit, item name,
  description, status, dates), newest first.
- `GET /api/admin/service-requests` — open requests with unit/type/user.
- `POST /api/admin/service-requests/:id/resolve` — stamps resolved_by/at;
  404 unknown, 409 already resolved. Unit status stays under the existing
  inventory controls (no coupling).
- Employee "Raise Service Request" page: QR scan or manual asset id
  (existing scanner + `parseAssetId` + by-asset lookup), description box,
  submit. "View Request Status" lists item requests (existing
  `GET /api/requests`) AND service requests. Admin "View Request" page lists
  returns needing attention (existing `GET /api/admin/attention`) and open
  service requests, each resolvable.

## Feature 2: pre-answered return questions (new backend)

- Same migration: `borrow_sessions.draft_answers jsonb`; `active_borrows`
  view appends `s.draft_answers`; `mark_returned` (create-or-replace, same
  7-arg signature) also sets `draft_answers = null` when closing a session.
- `PUT /api/borrow/:sessionId/draft-answers` `{ answers }` — owner only,
  active session only. Validation is PARTIAL: unknown keys → 400, wrong
  types → 400, but completeness is NOT required (that stays a return-time
  rule). New `validateDraftAnswers` helper in `api/src/questionnaire.ts`.
- My Assets: items whose type has return questions get "Answer return
  questions" in the ⋯ menu — the questionnaire sheet without any
  unlock/return, Save stores the draft.
- Return flow: the return sheet initializes its answers from
  `draft_answers` (prefilled, editable — a confirmation pass). Submission
  is unchanged; the draft clears on return.

## Visual changes

- Primary action color in dark mode becomes the palette's muted steel
  `#8CB1C2` (with deep-navy text); pressed state a darker step (#6E94A8).
  Light mode keeps `#256E9C`. (Fixes "buttons too bright".)
- `--muted` lightened in dark mode for AA on cards (fixes My Items
  contrast).
- `scrollbar-gutter: stable` on the root (fixes the header shifting between
  pages of different heights).
- Admin off-centering disappears into the new dashboard layout: admin
  Dashboard = stat cards (computed client-side from existing availability +
  admin borrows + attention data) + attention preview.
- Login unchanged (no images). Backend behavior otherwise untouched; all
  existing tests keep passing.

## Constraints

- Existing endpoints and flows unchanged except the additions above.
- Print labels, touch targets, reduced-motion behavior from restyle v1 all
  preserved.
