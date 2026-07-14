# Rack

Self-serve equipment checkout for Orbifold AI. Users sign in, pick an available
item, and the backend creates a borrow session and remotely unlocks the smart
cabinet (TTLock lock + WiFi gateway, driven through the [Seam API](https://docs.seam.co/api)).
Overdue items trigger daily email reminders; admins track who has what.

## Architecture

A self-hosted Fastify API in front of plain Postgres — two containers (`db`,
`api`), no external platform dependency:

- **Fastify API** (`api/src`) — email+password auth with DB-backed session
  cookies (`rack_session`, httpOnly + signed); every write goes through the
  same atomic SQL functions used by the tests below. Static assets for the
  frontend are served from `web/dist` with an SPA fallback for any
  non-`/api` path.
  - `POST /api/borrow` — claims a unit atomically (`borrow_unit` function),
    unlocks the cabinet via Seam, and cancels the session if the door never
    opened. Optional `unit_id` claims one specific unit (QR scan checkout).
  - `POST /api/return` — unlocks so the user can put the item back, then
    `mark_returned`.
  - `GET /api/units/by-asset/:assetId` — resolves a printed QR label to its
    unit; the SPA route `/scan/:assetId` uses it to check out that exact unit.
    Admins print labels from `/admin/labels` (`POST /api/admin/assign-asset-ids`
    backfills sequential `RACK-NNNN` ids for unlabeled units).
  - `/api/requests` — waitlist / notify-when-available / future reservations
    against an item type (`item_requests` table). When a unit becomes available
    (return, admin status change, new stock), everyone with a `notify` request
    and the head of the waitlist get an email; reservations get a reminder
    email within a day of their start date via the daily cron.
  - Item types can define **return questions** (e.g. SD cards: "What's on the
    card?", "Important — must not be wiped?"). Users answer them on return;
    a flagged answer emails admins and lands in the **attention queue**
    (`GET /api/admin/attention`, resolve via
    `POST /api/admin/attention/:id/resolve`) without holding the unit, and the
    next borrower of that exact unit sees the previous report in the borrow
    response (`last_return`). Borrowing is refused with a 409 while the caller
    has any overdue loan — returning or extending clears it.
  - Reminders run **in-process** via `node-cron` (daily at 09:00), calling the
    same `runReminders()` the dev trigger (`POST /api/dev/run-reminders`,
    non-production only) uses — one email per user listing all overdue items,
    plus upcoming-reservation reminders (Resend).
- **Postgres** — schema in `db/migrations/`, applied by a small migration
  runner (`api/src/migrate.ts`) that tracks applied files in `_migrations`.
  All authorization lives in the API layer (no RLS); the API is the only
  client that ever touches these tables.
- **Seam** — the backend calls Seam, never TTLock directly. `SEAM_API_URL` is
  overridable for the sandbox/mock.

### Data model

| Table | Purpose |
|---|---|
| `profiles` | app users; `role` is `user` or `admin`; `password_hash` for login |
| `sessions` | server-side login sessions backing the `rack_session` cookie |
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

Requires Docker (e.g. [OrbStack](https://orbstack.dev) or Docker Desktop) and
[Deno](https://deno.com) (for the Seam/Resend mock).

```sh
docker compose up -d db
(cd api && npm run migrate -- --seed)      # schema + real Orbifold inventory
(cd api && npx tsx ../scripts/seed-dev-users.ts)   # admin@rack.local / user@rack.local

# Mock Seam/Resend so no accounts or hardware are needed:
deno run --allow-net --allow-env scripts/mock-seam.ts 9911 &

cd api && SEAM_API_URL=http://127.0.0.1:9911 RESEND_API_URL=http://127.0.0.1:9911 \
  SEAM_API_KEY=mock RESEND_API_KEY=mock npm run dev &

./scripts/smoke-test.sh    # E2E: auth, browse+authz, borrow, race test, return, reminders
```

Seeded dev users (local only): `admin@rack.local` / `user@rack.local`,
password `password123`.

The seed imports the **Orbifold Asset Tracker** spreadsheet. Rows the sheet
left ambiguous carry a `SEED-TODO:` note: Enoch's two keyboards are `in_use`
with no session, the Meta Quest 3 is `missing` ("only the box was found"), and
MX Keys / Logitech Mouse / MacBooks have zero units until real quantities are
known.

If `psql` isn't installed on the host, override `PSQL_BIN` for the smoke
test, e.g. `PSQL_BIN="docker compose exec -T db psql -U rack rack" ./scripts/smoke-test.sh`
(this is already the script's default).

### Frontend

The web app is a Vite + React SPA in `web/`.

```sh
cd web && npm install
npm run dev     # Vite on http://localhost:5173, proxies /api → :3000 (run the API too, see above)
npm test        # Vitest + React Testing Library unit tests
npm run build   # production build → web/dist (tsc + vite)
```

`web/dist` is gitignored and built at deploy time — the API serves it with an
SPA fallback in production, and `docker compose --profile prod up` mounts
`./web/dist` into the API container, so run `npm --prefix web run build`
before deploying.

End-to-end test (`npm run e2e`, Playwright — starts the Vite dev server
itself) expects the dev stack from the block above: db migrated + seeded with
dev users, mock Seam on `:9911`, and the API on `:3000` with
`SEAM_API_URL`/`RESEND_API_URL` pointed at the mock. Pair the seeded lock with
the mock device once:

```sh
docker compose exec -T db psql -U rack rack \
  -c "update locks set seam_device_id='mock-device-1' where name='Main cabinet TTLock';"
(cd web && npx playwright install chromium && npm run e2e)
```

### Running the tests

`npm test` (in `api/`) runs against a **separate** `rack_test` database, never
the dev `rack` database — `resetDb()` (in `api/test/helpers.ts`) drops and
recreates the whole `public` schema on every run, so it refuses to run
against anything whose database name doesn't end in `_test`. `api/test/setup.ts`
defaults `DATABASE_URL` to `postgresql://rack:rack@localhost:5433/rack_test`
whenever it isn't already pointed at a `_test` database, so plain
`npx vitest run` with no env vars is safe by default.

Create the test database once (same Postgres container as dev, just a
different database):

```sh
docker compose exec db psql -U rack -c 'create database rack_test'
```

Then:

```sh
cd api && npm test
```

### Non-standard local database

If your `DATABASE_URL` for a manual test run points somewhere other than the
default, keep the database name ending in `_test` — the guard in
`resetDb()` throws otherwise rather than risk dropping real data.

To exercise the Seam-failure compensation path (borrow must cancel the
session when the door never opens): restart the mock with
`MOCK_SEAM_FAIL=1`, then `POST /api/borrow` manually — expect a `502` and the
session left `cancelled` (not stranded `active`). Not scripted in
`smoke-test.sh` since it requires reconfiguring the mock mid-run.

## Secrets

| Secret | Used by | Notes |
|---|---|---|
| `SESSION_SECRET` | all authenticated routes | signs the `rack_session` cookie; random string |
| `SEAM_API_KEY` | borrow, return | sandbox key for dev, production key for prod |
| `RESEND_API_KEY` | reminders | verify your sending domain in Resend |
| `EMAIL_FROM` | reminders | e.g. `Rack <rack@orbifold.ai>` |

Set via `.env` (copy `.env.example`); `docker-compose.yml`'s `api` service
reads it with `env_file: .env`. Cron is in-process now (`node-cron`), so
there's no separate cron secret to manage.

## Production

Runs on an office box via Docker Compose, no external platform:

```sh
docker compose --profile prod up -d
```

This builds `api/Dockerfile`, mounts `./db` (migrations + seed) and
`./web/dist` (static frontend) read-only into the container, and runs
pending migrations automatically on boot (`runMigrations()` before the
server listens).

**First boot only** — migrations run automatically, but seeding the real
inventory does not; run it once, by hand, against the prod db container:

```sh
docker compose exec -T db psql -U rack rack < db/seed.sql
```

Re-running it is *not* fully safe (see the note above `item_types` in
`db/seed.sql` — the cabinet/lock rows are idempotent, the inventory rows are
not), so only do this against a freshly-migrated, empty database.

The daily overdue-reminder email fires at 09:00 in the `TZ` timezone (see
`.env.example`; defaults to `America/Los_Angeles`), not the container's UTC
clock.

Nightly backups — host cron, not container cron:

```
0 3 * * * docker compose -f /path/to/rack/docker-compose.yml exec -T db pg_dump -U rack rack > /path/to/rack/db/backups/rack-$(date +\%F).sql
```

Pair the lock: set it up in the TTLock app (be top administrator, enable
Remote Unlock), create a Seam workspace, link the TTLock account via a
Connect Webview, then:

```sql
update locks set seam_device_id = '<device id>' where name = 'Main cabinet TTLock';
```

⚠️ Buy only genuine TTLock-app devices — Tuya/eLinkSmart etc. won't work with Seam.

Promote the first admin:

```sh
docker compose exec db psql -U rack rack -c "update profiles set role='admin' where email='you@orbifold.ai'"
```

## v2 ideas (deliberately out of scope)

- Time-bound keypad PINs (`borrow_sessions.seam_access_code_id` is reserved for this)
- Seam webhook ingestion (lock events → `device_events`)
- Per-user borrow limits; retryable `pending_unlock` session state if Seam
  proves flaky
- Stranded-session sweep: if the API process dies between claiming a unit and
  the Seam unlock resolving, the session stays active; a periodic job should
  auto-cancel active sessions with no unlock outcome event after N minutes.
- Frontend web app (`web/dist` currently holds only a placeholder — a real
  frontend is a separate plan)

---

This project originally ran on Supabase (Postgres + RLS + Edge Functions);
that implementation is preserved in git history prior to the `backend-port`
branch.
