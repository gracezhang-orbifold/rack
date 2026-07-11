# Rack — Self-Hosted Backend + Frontend Design

**Date:** 2026-07-10
**Status:** Approved pending user review

## Context

Rack is Orbifold AI's self-serve equipment checkout system: users browse
inventory on their phone, tap Borrow, and the smart cabinet (TTLock lock +
gateway, driven via the Seam API) unlocks. A Supabase-based backend was built
and verified end-to-end (16/16 smoke test checks, including a concurrency race
test and the Seam-failure compensation path).

Grace then decided the system must be **fully self-hosted on a local office
machine, at $0, with no Supabase dependency**. This design replaces the
Supabase platform wrapper (GoTrue auth, PostgREST, edge functions, pg_cron)
with a small self-owned server, while porting the verified core — Postgres
schema, race-safe borrow logic, Seam integration, reminder idempotency, seed
data, and mock-based testing — nearly unchanged. It also specifies the
frontend, which was designed in the same session.

## Decisions (settled with Grace)

| Decision | Choice |
|---|---|
| Hosting | Local office machine, `docker compose`, $0 |
| Backend | Node (Fastify, TypeScript) + Postgres — no Supabase |
| Auth | Email + password, session cookies, self-serve signup |
| Frontend | Vite + React SPA, Tailwind, TanStack Query, hand-rolled components |
| Frontend data | REST API only (no direct DB access from browser) |
| Admin scope | Full: overview, who-has-what, history, mark-returned override, inventory CRUD |
| Look & feel | Clean utility, mobile-first, search bar on Browse |
| Unlock flow | Seam remote unlock in v1; PIN codes reserved for v2 |

## Architecture

One repo, one `docker compose up` on the office box, two containers:

```
rack/
├── db/            # Postgres 17 container
│   └── migrations/    # ported from supabase/migrations (see Schema)
├── api/           # Fastify server (TypeScript), serves /api/* AND web/dist
│   └── src/
│       ├── auth/      # signup, login, logout, session middleware, bcrypt
│       ├── routes/    # availability, borrows, admin
│       ├── seam.ts    # ported: unlock + action-attempt poll, SEAM_API_URL overridable
│       ├── resend.ts  # ported: reminder emails, RESEND_API_URL overridable
│       └── reminders.ts  # node-cron 9am daily, 20h idempotency window
├── web/           # Vite + React SPA → built to web/dist
└── scripts/       # mock-seam.ts (kept), smoke-test.sh (adapted to new API)
```

- **db** — Postgres with the existing schema ported: same tables, enums,
  views, indexes, and the SQL functions `borrow_unit` / `mark_returned` /
  `cancel_borrow_session` (FOR UPDATE SKIP LOCKED claim + partial unique index
  `one_active_session_per_unit` — the verified double-borrow guards). Changes
  in the port: RLS policies and Supabase grants are dropped (only the API
  talks to the DB; authorization moves to server middleware), `auth.users`
  references become a `password_hash` column on `profiles`, `auth.uid()`
  parameters become explicit `p_user_id` arguments, and the pg_cron/Vault/
  pg_net migration is deleted (replaced by node-cron in the API).
- **api** — Fastify. Session cookie auth (httpOnly, SameSite=Lax; bcrypt
  password hashes; sessions table in Postgres). `user`/`admin` roles live on
  `profiles` as today; first admin promoted via SQL. The server serves the
  built SPA as static files — one port for everything,
  `http://<office-box>:3000` on the LAN. Migrations run automatically at API
  startup (simple ordered-SQL runner; no framework).
- **web** — the SPA (see Frontend below). In dev it runs on Vite's dev server
  proxying `/api` to the API; in prod it's static files.

Scalability: Postgres is the scale-bearing component; the API is stateless
(sessions in the DB), so this moves to any bigger box or cloud VM unchanged.

## API surface

All JSON. Auth via session cookie; 401 when missing/expired; admin routes 403
for non-admins.

| Route | Who | Behavior |
|---|---|---|
| `POST /api/auth/signup` | public | email+password+name → creates profile (role `user`), starts session |
| `POST /api/auth/login` | public | verify bcrypt, start session |
| `POST /api/auth/logout` | user | destroy session |
| `GET /api/me` | user | profile incl. role |
| `GET /api/availability` | user | the `item_availability` view (+ item_type notes) |
| `GET /api/my-borrows` | user | own active sessions (with overdue flag) + past history |
| `POST /api/borrow` | user | `{item_type_id, days=7}` → `borrow_unit` in a transaction → Seam unlock → on Seam failure `cancel_borrow_session` + 502; on no units 409; audit rows in `device_events` either way. `unlock: "ok" \| "skipped"` in response (skipped = no lock paired) |
| `POST /api/return` | user | `{session_id}` → ownership check → Seam unlock → `mark_returned`; unlock failure = 502, nothing changes |
| `GET /api/admin/borrows` | admin | all active sessions (the `active_borrows` view) + history w/ filters |
| `POST /api/admin/return` | admin | `{session_id}` → `mark_returned` without unlock (data fix-up) |
| `GET/POST/PATCH /api/admin/item-types`, `/api/admin/item-units` | admin | inventory CRUD (add units, set status needs_repair/retired/missing, notes) |

Borrow/return semantics are ports of the verified edge functions: a session is
only ever `active` if the door actually opened (or unlock was explicitly
skipped because no lock is paired).

## Reminders

`node-cron` inside the API process, daily 9:00 AM local. Same verified query:
`status='active' AND due_at < now() AND (last_reminded_at IS NULL OR
last_reminded_at < now() - interval '20 hours')`. One Resend email per user
listing all overdue items; `last_reminded_at`/`reminder_count` stamped only on
2xx. `EMAIL_FROM`, `RESEND_API_KEY`, `RESEND_API_URL` env vars as today.

## Frontend

Mobile-first SPA, five screens, bottom tab bar (Browse / My Items / Admin —
admin tab only for admins):

1. **Sign in / Sign up** — email + password card, toggle between modes.
2. **Browse** (home) — search bar filtering client-side by name/category;
   inventory grouped by category from `/api/availability`; each row shows
   `available/total` badge and a Borrow button (disabled at 0). Borrow →
   confirm sheet (due presets, default 7 days, 1–90) → full-screen result:
   "Cabinet unlocked — take your item", "cabinet not connected — find an
   admin" (unlock skipped), or the backend's failure message verbatim.
3. **My Items** — own active borrows with red overdue flags, Return button →
   same unlock flow ("put it back"), collapsed history below.
4. **Admin: Overview** — all active borrows (overdue first), availability
   table incl. needs-repair/missing, Mark-returned override.
5. **Admin: Inventory** — add/edit item types and units (fixes the SEED-TODO
   quantities), change unit status, edit notes.

**State:** TanStack Query for all server state (`['availability']`,
`['my-borrows']`, `['admin-borrows']`, `['inventory']`), refetch-on-focus;
mutations invalidate affected keys. Auth = `/api/me` in a small context.
No other global store.

**Error handling:** relay backend errors, don't interpret. 409 → toast +
refetch ("someone beat you to it"). 502 → retry screen stating nothing was
checked out (borrow) / item still checked out (return). Network down →
full-width "can't reach Rack" banner. 401 → redirect to sign-in. Success
screens only render after the API confirms.

**Out of scope for v1:** photos, realtime availability updates, cabinets/locks
management UI, device-events viewer, PIN codes, HTTPS/tunnel for off-LAN
access (documented as a follow-up: free Cloudflare Tunnel if remote access is
wanted).

## Testing

- **Port-parity smoke test:** adapt `scripts/smoke-test.sh` to the new API
  (curl against `http://localhost:3000/api/...`): signup/login, browse, RLS-
  equivalent authz checks (non-admin blocked from admin routes), borrow happy
  path with mock Seam, the 2-concurrent-borrows race test, return, Seam
  failure compensation (`MOCK_SEAM_FAIL=1`), reminder idempotency (via `POST /api/dev/run-reminders`, enabled only when
  `NODE_ENV !== 'production'`), wrong-role
  and unauthenticated rejections. `scripts/mock-seam.ts` is kept as-is.
- **API unit/integration tests** (Vitest + a test DB): auth flows, borrow
  transaction edge cases.
- **Frontend:** Vitest + React Testing Library for the borrow-sheet state
  machine, search filter, role-gated tabs; one Playwright E2E against the full
  local stack + mock Seam (sign in → search → borrow → My Items → return →
  admin mark-returned).

## Deployment (office box)

`docker compose up -d` runs `db` and `api` (api serves the SPA). `.env` holds
`SEAM_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SESSION_SECRET`,
`DATABASE_URL`. Seed script imports the Orbifold Asset Tracker inventory
(same data + SEED-TODO conventions as today). Nightly `pg_dump` to a local
`backups/` folder via host cron (documented one-liner in the README). Pair the TTLock via Seam
Connect, set `locks.seam_device_id`, promote the first admin — same runbook
as before, minus anything Supabase.

## Build order

Two sub-projects, each with its own implementation plan:

1. **Backend port** — db migrations port, Fastify API, reminders, adapted
   smoke test proving parity with the verified Supabase behavior.
2. **Frontend** — the SPA against the new API, finishing with the Playwright
   E2E.

The existing `supabase/` directory stays in git history but is removed from
the working tree once the port's smoke test passes, so there's one source of
truth.
