# Rack

Self-serve equipment checkout for Orbifold AI. Users sign in, pick an available
item, and the backend creates a borrow session and remotely unlocks the smart
cabinet (TTLock lock + WiFi gateway, driven through the [Seam API](https://docs.seam.co/api)).
Overdue items trigger daily email reminders; admins track who has what.

## Architecture

Supabase-only — no separate server:

- **Postgres + RLS** — schema in `supabase/migrations/`. Users browse inventory
  and read their own sessions; every state change goes through `SECURITY DEFINER`
  RPCs or the service role. Clients never write tables directly.
- **Edge Functions** (`supabase/functions/`):
  - `borrow` — claims a unit atomically (`borrow_unit` RPC), unlocks the cabinet
    via Seam, and cancels the session if the door never opened.
  - `return` — unlocks so the user can put the item back, then `mark_returned`.
  - `overdue-reminders` — invoked daily by pg_cron; one email per user listing
    all overdue items (Resend). Guarded by the `x-cron-secret` header.
- **Seam** — the backend calls Seam, never TTLock directly. `SEAM_API_URL` is
  overridable for the sandbox/mock.

### Data model

| Table | Purpose |
|---|---|
| `profiles` | mirrors `auth.users`; `role` is `user` or `admin` |
| `cabinets` | physical cabinets |
| `locks` | Seam-connected locks (`kind`: `cabinet` or `keybox`); `seam_device_id` set after pairing |
| `item_types` | catalog entries ("GoPro 13 Black") |
| `item_units` | one row per physical unit; status: available / in_use / needs_repair / retired / missing |
| `borrow_sessions` | checkouts: active / returned / cancelled; "overdue" is derived (`active` + past `due_at`) |
| `device_events` | audit log of every unlock attempt |

Views: `item_availability` (computed counts per type — never stored) and
`active_borrows` (who has what, with an `is_overdue` flag).

Double-borrow protection is two-layer: `borrow_unit` claims with
`FOR UPDATE SKIP LOCKED`, and a partial unique index allows at most one
`active` session per unit.

## Local development

Requires Docker (e.g. [OrbStack](https://orbstack.dev) or Docker Desktop) and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

```sh
supabase start
supabase db reset          # migrations + seed (real Orbifold inventory + dev users)

# Mock Seam/Resend so no accounts or hardware are needed:
printf 'SEAM_API_KEY=mock\nSEAM_API_URL=http://host.docker.internal:9911\nRESEND_API_KEY=mock\nRESEND_API_URL=http://host.docker.internal:9911\nCRON_SECRET=local-cron-secret\n' > supabase/functions/.env
deno run --allow-net --allow-env scripts/mock-seam.ts 9911 &
supabase functions serve --env-file supabase/functions/.env &

./scripts/smoke-test.sh    # E2E: auth, RLS, borrow, race test, return, reminders
```

If `psql` isn't installed on the host, run it through the DB container:

```sh
PSQL_BIN="docker exec -i supabase_db_rack psql" \
SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres" \
./scripts/smoke-test.sh
```

To exercise the Seam-failure compensation path (borrow must cancel the session
when the door never opens), restart the mock with `MOCK_SEAM_FAIL=1` and run
`FAIL_MODE=1 ./scripts/smoke-test.sh`.

Seeded dev users (local only): `admin@rack.local` / `user@rack.local`,
password `password123`.

The seed imports the **Orbifold Asset Tracker** spreadsheet. Rows the sheet
left ambiguous carry a `SEED-TODO:` note: Enoch's two keyboards are `in_use`
with no session, the Meta Quest 3 is `missing` ("only the box was found"), and
MX Keys / Logitech Mouse / MacBooks have zero units until real quantities are
known.

## Secrets

| Secret | Used by | Notes |
|---|---|---|
| `SEAM_API_KEY` | borrow, return | sandbox key for dev, production key for prod |
| `RESEND_API_KEY` | overdue-reminders | verify your sending domain in Resend |
| `EMAIL_FROM` | overdue-reminders | e.g. `Rack <rack@orbifold.ai>` |
| `CRON_SECRET` | overdue-reminders | random string; must match the Vault entry |

Set with `supabase secrets set KEY=value` (prod) or `supabase/functions/.env` (local).

## Production cutover

1. `supabase link --project-ref <ref>` then `supabase db push` and
   `supabase functions deploy borrow return overdue-reminders`.
2. `supabase secrets set SEAM_API_KEY=... RESEND_API_KEY=... EMAIL_FROM=... CRON_SECRET=...`
3. Seed the Vault entries the cron job reads (SQL editor):
   `select vault.create_secret('https://<ref>.supabase.co', 'project_url');`
   `select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');`
4. Import inventory: run the inventory portion of `supabase/seed.sql` (skip the
   local-dev users block).
5. Pair the lock: set it up in the TTLock app (be top administrator, enable
   Remote Unlock), create a Seam workspace, link the TTLock account via a
   Connect Webview, then
   `update locks set seam_device_id = '<device id>' where name = 'Main cabinet TTLock';`
   ⚠️ Buy only genuine TTLock-app devices — Tuya/eLinkSmart etc. won't work with Seam.
6. Promote the first admin:
   `update profiles set role = 'admin' where email = 'you@orbifold.ai';`

## v2 ideas (deliberately out of scope)

- Time-bound keypad PINs (`borrow_sessions.seam_access_code_id` is reserved for this)
- Seam webhook ingestion (lock events → `device_events`)
- Per-user borrow limits; retryable `pending_unlock` session state if Seam
  proves flaky
- Frontend web app (this repo is backend-only)
