# Rack Backend Port (Supabase → Fastify + Postgres) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase platform wrapper with a self-hosted Fastify (TypeScript) + Postgres backend that preserves the verified borrow/return/reminder behavior, proven by an adapted smoke test.

**Architecture:** Two docker-compose services (`db` = Postgres 17, `api` = Fastify). The verified SQL core (schema, views, `borrow_unit`/`mark_returned`/`cancel_borrow_session`, partial unique index) ports from `supabase/migrations/` with auth references replaced by explicit parameters. Auth = email+password with bcrypt and DB-backed session cookies. Seam/Resend helpers port from the Deno edge functions to Node modules; pg_cron becomes node-cron in-process.

**Tech Stack:** Node 22, TypeScript, Fastify 5, `pg`, `bcryptjs`, `node-cron`, Vitest, docker compose (Postgres 17).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-rack-selfhosted-design.md` — API routes, semantics, and error codes must match its API surface table verbatim.
- A borrow session is only ever `active` if the door opened OR unlock was explicitly skipped (no lock paired). Seam failure ⇒ session cancelled ⇒ HTTP 502.
- No units available ⇒ HTTP 409. Unauthenticated ⇒ 401. Non-admin on admin route ⇒ 403.
- `SEAM_API_URL` and `RESEND_API_URL` must stay env-overridable (mock server depends on it).
- Reminder idempotency window: 20 hours. One email per user listing all overdue items.
- Dev ports: Postgres on host `5433` (54322 is Supabase local), API on `3000`.
- All timestamps `timestamptz`; IDs `uuid` via `gen_random_uuid()`.
- Reference sources to port (read them; they are in the working tree until Task 8): `supabase/migrations/*.sql`, `supabase/functions/_shared/{seam,resend}.ts`, `supabase/functions/{borrow,return,overdue-reminders}/index.ts`, `supabase/seed.sql`, `scripts/smoke-test.sh`.

## File Structure

```
db/migrations/001_schema.sql        # tables, enums, indexes (port of 000200 + profiles/sessions changes)
db/migrations/002_views.sql         # port of 000300, unchanged except no security_invoker
db/migrations/003_functions.sql     # port of 000400 with explicit p_user_id params
db/seed.sql                         # inventory DO-block port of supabase/seed.sql (no auth.users)
docker-compose.yml                  # db + api services
api/package.json, api/tsconfig.json, api/vitest.config.ts, api/Dockerfile
api/src/env.ts                      # typed env access
api/src/db.ts                       # pg Pool + query helper
api/src/migrate.ts                  # ordered SQL runner, _migrations table
api/src/auth.ts                     # bcrypt, sessions, requireUser/requireAdmin hooks
api/src/seam.ts                     # port of _shared/seam.ts (Deno→Node)
api/src/resend.ts                   # port of _shared/resend.ts
api/src/reminders.ts                # overdue query + email loop + node-cron schedule
api/src/routes/auth.ts              # signup/login/logout/me
api/src/routes/catalog.ts           # availability, my-borrows
api/src/routes/borrow.ts            # borrow, return (Seam orchestration)
api/src/routes/admin.ts             # admin borrows/return/item-types/item-units
api/src/server.ts                   # buildServer(): registers everything; also static serving
api/src/index.ts                    # main: migrate, listen, start cron
api/test/helpers.ts                 # test app + test DB reset
api/test/*.test.ts                  # per-route integration tests
scripts/seed-dev-users.ts           # bcrypt dev users (admin@rack.local etc.)
scripts/smoke-test.sh               # rewritten against the new API (cookie-based)
.env.example
```

---

### Task 1: Scaffold — compose, API skeleton, health route

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `api/package.json`, `api/tsconfig.json`, `api/vitest.config.ts`, `api/src/env.ts`, `api/src/server.ts`, `api/src/index.ts`, `api/test/health.test.ts`
- Modify: `.gitignore` (add `api/node_modules/`, `api/dist/`, `db/backups/`)

**Interfaces:**
- Produces: `buildServer(): Promise<FastifyInstance>` from `api/src/server.ts` (no listen; used by all tests). `env` object from `api/src/env.ts` with `DATABASE_URL, PORT, SESSION_SECRET, SEAM_API_KEY, SEAM_API_URL, RESEND_API_KEY, RESEND_API_URL, EMAIL_FROM, CRON_ENABLED, NODE_ENV`.

- [ ] **Step 1: Write compose + env files**

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: rack
      POSTGRES_PASSWORD: rack
      POSTGRES_DB: rack
    ports: ["5433:5432"]
    volumes: ["rack_pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rack"]
      interval: 2s
      timeout: 2s
      retries: 15
  api:
    build: ./api
    profiles: ["prod"]          # dev runs the API on the host via tsx
    env_file: .env
    environment:
      DATABASE_URL: postgresql://rack:rack@db:5432/rack
    ports: ["3000:3000"]
    depends_on:
      db: { condition: service_healthy }
volumes:
  rack_pgdata:
```

`.env.example`:
```sh
DATABASE_URL=postgresql://rack:rack@localhost:5433/rack
PORT=3000
SESSION_SECRET=change-me-long-random
SEAM_API_KEY=seam_test_...
SEAM_API_URL=https://connect.getseam.com
RESEND_API_KEY=re_...
RESEND_API_URL=https://api.resend.com
EMAIL_FROM=Rack <onboarding@resend.dev>
CRON_ENABLED=true
```

- [ ] **Step 2: API package scaffold**

`api/package.json`:
```json
{
  "name": "rack-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "migrate": "tsx src/migrate.ts"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.0",
    "@fastify/static": "^8.0.0",
    "bcryptjs": "^2.4.3",
    "fastify": "^5.0.0",
    "node-cron": "^3.0.3",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "outDir": "dist", "rootDir": "src",
    "skipLibCheck": true, "esModuleInterop": true
  },
  "include": ["src"]
}
```

`api/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { fileParallelism: false, hookTimeout: 30000, testTimeout: 30000 },
});
```
(Sequential files: tests share one database.)

`api/src/env.ts`:
```ts
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env var ${name}`);
  return v;
}
export const env = {
  DATABASE_URL: req("DATABASE_URL", "postgresql://rack:rack@localhost:5433/rack"),
  PORT: Number(req("PORT", "3000")),
  SESSION_SECRET: req("SESSION_SECRET", "dev-secret"),
  SEAM_API_KEY: req("SEAM_API_KEY", ""),
  SEAM_API_URL: req("SEAM_API_URL", "https://connect.getseam.com"),
  RESEND_API_KEY: req("RESEND_API_KEY", ""),
  RESEND_API_URL: req("RESEND_API_URL", "https://api.resend.com"),
  EMAIL_FROM: req("EMAIL_FROM", "Rack <onboarding@resend.dev>"),
  CRON_ENABLED: req("CRON_ENABLED", "true") === "true",
  NODE_ENV: req("NODE_ENV", "development"),
};
```

`api/src/server.ts`:
```ts
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { env } from "./env.js";

export async function buildServer() {
  const app = Fastify({ logger: env.NODE_ENV !== "test" });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  app.get("/api/health", async () => ({ ok: true }));
  return app;
}
```

`api/src/index.ts`:
```ts
import { buildServer } from "./server.js";
import { env } from "./env.js";

const app = await buildServer();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
```

- [ ] **Step 3: Write the failing test**

`api/test/health.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("health", () => {
  it("responds ok", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 4: Install and run test**

Run: `cd api && npm install && NODE_ENV=test npx vitest run`
Expected: PASS (1 test). (Written before implementation completes it's red; green after Step 2 files exist — order Steps 3 then 2 if strict TDD.)

- [ ] **Step 5: Boot the DB and commit**

Run: `docker compose up -d db && docker compose ps` — expect `db` healthy.
```bash
git add docker-compose.yml .env.example .gitignore api
git commit -m "feat: scaffold self-hosted API (Fastify) and Postgres compose"
```

---

### Task 2: Migration runner + ported schema/views/functions + seed

**Files:**
- Create: `db/migrations/001_schema.sql`, `db/migrations/002_views.sql`, `db/migrations/003_functions.sql`, `db/seed.sql`, `api/src/db.ts`, `api/src/migrate.ts`, `api/test/helpers.ts`, `api/test/migrate.test.ts`

**Interfaces:**
- Consumes: `env` (Task 1).
- Produces: `pool` and `query(text, params?)` from `api/src/db.ts`; `runMigrations(pool, dir?)` and `runSeed(pool)` from `api/src/migrate.ts`; SQL functions `borrow_unit(p_user_id uuid, p_item_type_id uuid, p_days int) returns table(session_id uuid, item_unit_id uuid, due_at timestamptz)`, `mark_returned(p_session_id uuid, p_user_id uuid, p_is_admin boolean) returns void`, `cancel_borrow_session(p_session_id uuid) returns void`; test helper `resetDb()` from `api/test/helpers.ts`.

- [ ] **Step 1: Port the schema**

`db/migrations/001_schema.sql` — port of `supabase/migrations/20260710000200_schema.sql` with these exact deltas (everything else verbatim: all enums, cabinets, locks, item_types, item_units, borrow_sessions, device_events, all indexes including `one_active_session_per_unit`, the `touch_updated_at` trigger):

```sql
-- profiles: standalone (no auth.users); owns credentials.
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  full_name     text,
  role          public.user_role not null default 'user',
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on public.sessions (user_id);
```
Drop from the port: the `handle_new_user` trigger/function (no auth.users), all `security definer`/`set search_path` clauses (single-role DB), and the RLS/grants file entirely. Do NOT port `20260710000100_extensions.sql` or `..._000600_cron.sql`.

- [ ] **Step 2: Port views and functions**

`db/migrations/002_views.sql`: `supabase/migrations/20260710000300_views.sql` verbatim minus `with (security_invoker = true)`.

`db/migrations/003_functions.sql`: port of `..._000400_functions.sql` — drop `is_admin()` (server middleware decides), and replace `auth.uid()` with parameters:
```sql
create or replace function public.borrow_unit(p_user_id uuid, p_item_type_id uuid, p_days int default 7)
returns table (session_id uuid, item_unit_id uuid, due_at timestamptz)
language plpgsql as $$
declare
  v_unit_id uuid;
  v_session public.borrow_sessions;
begin
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'p_days must be between 1 and 90' using errcode = '22023';
  end if;
  select u.id into v_unit_id from public.item_units u
  where u.item_type_id = p_item_type_id and u.status = 'available'
  order by u.created_at limit 1 for update skip locked;
  if v_unit_id is null then
    raise exception 'no units available for this item type' using errcode = 'P0002';
  end if;
  update public.item_units set status = 'in_use' where id = v_unit_id;
  insert into public.borrow_sessions (user_id, item_unit_id, due_at)
  values (p_user_id, v_unit_id, now() + make_interval(days => p_days))
  returning * into v_session;
  return query select v_session.id, v_session.item_unit_id, v_session.due_at;
end; $$;

create or replace function public.mark_returned(p_session_id uuid, p_user_id uuid, p_is_admin boolean)
returns void language plpgsql as $$
declare v_session public.borrow_sessions;
begin
  select * into v_session from public.borrow_sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.user_id <> p_user_id and not p_is_admin then
    raise exception 'not allowed to return this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active' then raise exception 'session is not active' using errcode = 'P0001'; end if;
  update public.borrow_sessions set status = 'returned', returned_at = now() where id = p_session_id;
  update public.item_units set status = 'available' where id = v_session.item_unit_id;
end; $$;
```
`cancel_borrow_session(p_session_id uuid)`: verbatim from the source minus `security definer`/`search_path` lines.

- [ ] **Step 3: Port the inventory seed**

`db/seed.sql`: the DO-block + cabinet/lock inserts from `supabase/seed.sql` **verbatim**, with the entire "Local-dev users" section (auth.users/auth.identities/promote) deleted. Dev users move to `scripts/seed-dev-users.ts` (Task 3).

- [ ] **Step 4: db.ts + migrate.ts**

`api/src/db.ts`:
```ts
import pg from "pg";
import { env } from "./env.js";
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
export const query = (text: string, params?: unknown[]) => pool.query(text, params);
```

`api/src/migrate.ts`:
```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

export async function runMigrations(pool: pg.Pool, dir = DEFAULT_DIR) {
  await pool.query(`create table if not exists _migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set(
    (await pool.query(`select name from _migrations`)).rows.map((r) => r.name),
  );
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(readFileSync(path.join(dir, file), "utf8"));
      await client.query(`insert into _migrations (name) values ($1)`, [file]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
}

export async function runSeed(pool: pg.Pool) {
  const file = path.resolve(DEFAULT_DIR, "../seed.sql");
  await pool.query(readFileSync(file, "utf8"));
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  const { pool } = await import("./db.js");
  await runMigrations(pool);
  if (process.argv.includes("--seed")) await runSeed(pool);
  await pool.end();
}
```

- [ ] **Step 5: Test helper + failing test**

`api/test/helpers.ts`:
```ts
import pg from "pg";
import { runMigrations, runSeed } from "../src/migrate.js";
import { pool } from "../src/db.js";

export async function resetDb() {
  await pool.query(`drop schema public cascade; create schema public;`);
  await pool.query(`drop table if exists _migrations`);
  await runMigrations(pool);
  await runSeed(pool);
}
export { pool };
```
Tests run against a dedicated `rack_test` database: `DATABASE_URL=postgresql://rack:rack@localhost:5433/rack_test`. Create it once: `docker compose exec db psql -U rack -c 'create database rack_test'`.

`api/test/migrate.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, pool } from "./helpers.js";

describe("migrations + seed", () => {
  beforeAll(resetDb);
  it("creates 28 item types with correct availability", async () => {
    const { rows } = await pool.query(`select count(*)::int n from item_types`);
    expect(rows[0].n).toBe(28);
    const gopro = await pool.query(
      `select available_units::int a from item_availability where name = 'GoPro 13 Black'`);
    expect(gopro.rows[0].a).toBe(3);
  });
  it("borrow_unit claims a unit and enforces the race guard", async () => {
    await pool.query(`insert into profiles (id, email, password_hash) values
      ('99999999-9999-9999-9999-999999999999', 't@t.t', 'x')`);
    const t = await pool.query(`select id from item_types where name = 'Oculus'`);
    const s = await pool.query(`select * from borrow_unit($1, $2, 7)`,
      ["99999999-9999-9999-9999-999999999999", t.rows[0].id]);
    expect(s.rows[0].session_id).toBeTruthy();
    await expect(
      pool.query(`select * from borrow_unit($1, $2, 7)`,
        ["99999999-9999-9999-9999-999999999999", t.rows[0].id]),
    ).rejects.toThrow(/no units available/);
  });
});
```

- [ ] **Step 6: Run tests (fail → implement → pass)**

Run: `cd api && DATABASE_URL=postgresql://rack:rack@localhost:5433/rack_test NODE_ENV=test npx vitest run test/migrate.test.ts`
Expected: PASS after Steps 1–4 are complete; failures point at porting mistakes.

- [ ] **Step 7: Commit**

```bash
git add db api/src/db.ts api/src/migrate.ts api/test
git commit -m "feat: port schema, views, functions, seed to plain Postgres with migration runner"
```

---

### Task 3: Auth — signup/login/logout/me + session middleware + dev users

**Files:**
- Create: `api/src/auth.ts`, `api/src/routes/auth.ts`, `scripts/seed-dev-users.ts`, `api/test/auth.test.ts`
- Modify: `api/src/server.ts` (register routes)

**Interfaces:**
- Consumes: `query`/`pool` (Task 2).
- Produces: `requireUser` and `requireAdmin` Fastify preHandlers exporting `req.user = { id: string; email: string; role: "user" | "admin"; full_name: string | null }`; routes `POST /api/auth/signup {email,password,full_name}`, `POST /api/auth/login {email,password}`, `POST /api/auth/logout`, `GET /api/me`. Cookie name `rack_session` (httpOnly, SameSite=Lax, 30-day expiry, value = session row id, signed).

- [ ] **Step 1: Write failing tests**

`api/test/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb } from "./helpers.js";

describe("auth", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => { await resetDb(); app = await buildServer(); });

  const signup = (body: object) =>
    app.inject({ method: "POST", url: "/api/auth/signup", payload: body });

  it("signs up, sets cookie, /api/me works", async () => {
    const res = await signup({ email: "a@o.ai", password: "pw12345678", full_name: "A" });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "rack_session")!;
    expect(cookie.httpOnly).toBe(true);
    const me = await app.inject({ method: "GET", url: "/api/me",
      cookies: { rack_session: cookie.value } });
    expect(me.json()).toMatchObject({ email: "a@o.ai", role: "user" });
  });
  it("rejects duplicate email with 409 and bad login with 401", async () => {
    expect((await signup({ email: "a@o.ai", password: "pw12345678" })).statusCode).toBe(409);
    const bad = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "a@o.ai", password: "wrong" } });
    expect(bad.statusCode).toBe(401);
  });
  it("rejects short passwords with 400 and /api/me without cookie with 401", async () => {
    expect((await signup({ email: "b@o.ai", password: "short" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });
  it("logout invalidates the session", async () => {
    const res = await signup({ email: "c@o.ai", password: "pw12345678" });
    const cookie = res.cookies.find((c) => c.name === "rack_session")!;
    await app.inject({ method: "POST", url: "/api/auth/logout",
      cookies: { rack_session: cookie.value } });
    const me = await app.inject({ method: "GET", url: "/api/me",
      cookies: { rack_session: cookie.value } });
    expect(me.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd api && DATABASE_URL=postgresql://rack:rack@localhost:5433/rack_test NODE_ENV=test npx vitest run test/auth.test.ts`
Expected: FAIL (404 on routes).

- [ ] **Step 3: Implement**

`api/src/auth.ts`:
```ts
import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";
import { query } from "./db.js";

export interface AuthedUser {
  id: string; email: string; role: "user" | "admin"; full_name: string | null;
}
declare module "fastify" {
  interface FastifyRequest { user?: AuthedUser }
}

const SESSION_DAYS = 30;
export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function createSession(reply: FastifyReply, userId: string) {
  const { rows } = await query(
    `insert into sessions (user_id, expires_at)
     values ($1, now() + interval '${SESSION_DAYS} days') returning id`, [userId]);
  reply.setCookie("rack_session", rows[0].id, {
    path: "/", httpOnly: true, sameSite: "lax", signed: true,
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const sid = readSessionId(req);
  if (sid) await query(`delete from sessions where id = $1`, [sid]);
  reply.clearCookie("rack_session", { path: "/" });
}

function readSessionId(req: FastifyRequest): string | null {
  const raw = req.cookies["rack_session"];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : null;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const sid = readSessionId(req);
  if (sid) {
    const { rows } = await query(
      `select p.id, p.email, p.role, p.full_name from sessions s
       join profiles p on p.id = s.user_id
       where s.id = $1 and s.expires_at > now()`, [sid]);
    if (rows[0]) { req.user = rows[0]; return; }
  }
  reply.code(401).send({ error: "not authenticated" });
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent) return;
  if (req.user!.role !== "admin") reply.code(403).send({ error: "admin only" });
}
```

`api/src/routes/auth.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from "../auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string; full_name?: string } }>(
    "/api/auth/signup", async (req, reply) => {
      const { email, password, full_name } = req.body ?? {};
      if (!email || !email.includes("@")) return reply.code(400).send({ error: "valid email required" });
      if (!password || password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });
      const hash = await hashPassword(password);
      try {
        const { rows } = await query(
          `insert into profiles (email, full_name, password_hash)
           values (lower($1), $2, $3) returning id, email, role, full_name`,
          [email, full_name ?? null, hash]);
        await createSession(reply, rows[0].id);
        return rows[0];
      } catch (e: any) {
        if (e.code === "23505") return reply.code(409).send({ error: "email already registered" });
        throw e;
      }
    });

  app.post<{ Body: { email?: string; password?: string } }>(
    "/api/auth/login", async (req, reply) => {
      const { email, password } = req.body ?? {};
      const { rows } = await query(
        `select id, email, role, full_name, password_hash from profiles where email = lower($1)`,
        [email ?? ""]);
      if (!rows[0] || !password || !(await verifyPassword(password, rows[0].password_hash)))
        return reply.code(401).send({ error: "invalid email or password" });
      await createSession(reply, rows[0].id);
      const { password_hash, ...user } = rows[0];
      return user;
    });

  app.post("/api/auth/logout", async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireUser }, async (req) => req.user);
}
```

In `api/src/server.ts`, after the health route:
```ts
import { authRoutes } from "./routes/auth.js";
// inside buildServer():
await app.register(authRoutes);
```

`scripts/seed-dev-users.ts`:
```ts
// Creates admin@rack.local / user@rack.local (password123). Local dev only.
import { pool, query } from "../api/src/db.js";
import { hashPassword } from "../api/src/auth.js";

const hash = await hashPassword("password123");
await query(
  `insert into profiles (email, full_name, role, password_hash) values
   ('admin@rack.local', 'Rack Admin', 'admin', $1),
   ('user@rack.local', 'Rack User', 'user', $1)
   on conflict (email) do nothing`, [hash]);
await pool.end();
console.log("dev users ready");
```

- [ ] **Step 4: Run tests to verify pass**

Run: same vitest command. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api scripts/seed-dev-users.ts
git commit -m "feat: email+password auth with DB-backed session cookies"
```

---

### Task 4: Catalog routes — availability + my-borrows

**Files:**
- Create: `api/src/routes/catalog.ts`, `api/test/catalog.test.ts`
- Modify: `api/src/server.ts` (register)

**Interfaces:**
- Consumes: `requireUser` (Task 3), views from Task 2.
- Produces: `GET /api/availability` → array of `{item_type_id, name, category, notes, total_units, available_units, in_use_units, needs_repair_units, missing_units}` (counts as numbers); `GET /api/my-borrows` → `{active: [{session_id, item_name, category, asset_id, checked_out_at, due_at, is_overdue}], history: [{session_id, item_name, status, checked_out_at, returned_at}]}`.

- [ ] **Step 1: Write failing tests**

`api/test/catalog.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb } from "./helpers.js";

describe("catalog", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let cookie: string;
  beforeAll(async () => {
    await resetDb(); app = await buildServer();
    const res = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "u@o.ai", password: "pw12345678" } });
    cookie = res.cookies.find((c) => c.name === "rack_session")!.value;
  });
  it("requires auth", async () => {
    expect((await app.inject({ method: "GET", url: "/api/availability" })).statusCode).toBe(401);
  });
  it("returns availability with numeric counts", async () => {
    const res = await app.inject({ method: "GET", url: "/api/availability",
      cookies: { rack_session: cookie } });
    const rows = res.json();
    expect(rows).toHaveLength(28);
    const gopro = rows.find((r: any) => r.name === "GoPro 13 Black");
    expect(gopro.available_units).toBe(3);
  });
  it("my-borrows starts empty", async () => {
    const res = await app.inject({ method: "GET", url: "/api/my-borrows",
      cookies: { rack_session: cookie } });
    expect(res.json()).toEqual({ active: [], history: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure** — vitest as before, expect 404s.

- [ ] **Step 3: Implement**

`api/src/routes/catalog.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";

export async function catalogRoutes(app: FastifyInstance) {
  app.get("/api/availability", { preHandler: requireUser }, async () => {
    const { rows } = await query(`
      select item_type_id, name, category, notes,
             total_units::int, available_units::int, in_use_units::int,
             needs_repair_units::int, missing_units::int
      from item_availability order by category, name`);
    return rows;
  });

  app.get("/api/my-borrows", { preHandler: requireUser }, async (req) => {
    const active = await query(`
      select session_id, item_name, category, asset_id, checked_out_at, due_at, is_overdue
      from active_borrows where user_id = $1 order by due_at`, [req.user!.id]);
    const history = await query(`
      select s.id as session_id, t.name as item_name, s.status, s.checked_out_at, s.returned_at
      from borrow_sessions s
      join item_units u on u.id = s.item_unit_id
      join item_types t on t.id = u.item_type_id
      where s.user_id = $1 and s.status <> 'active'
      order by s.checked_out_at desc limit 50`, [req.user!.id]);
    return { active: active.rows, history: history.rows };
  });
}
```
Register in `server.ts`: `await app.register(catalogRoutes);`

- [ ] **Step 4: Run tests to verify pass** — expect PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat: availability and my-borrows routes"
```

---

### Task 5: Seam port + borrow/return routes

**Files:**
- Create: `api/src/seam.ts`, `api/src/routes/borrow.ts`, `api/test/borrow.test.ts`
- Modify: `api/src/server.ts` (register)

**Interfaces:**
- Consumes: `borrow_unit`/`mark_returned`/`cancel_borrow_session` (Task 2), `requireUser` (Task 3).
- Produces: `unlockDoor(deviceId: string): Promise<{ok: boolean; actionAttemptId?: string; error?: unknown}>` from `api/src/seam.ts`; `POST /api/borrow {item_type_id, days?}` → 200 `{session_id, item_unit_id, due_at, unlock: "ok"|"skipped"}` | 409 | 502; `POST /api/return {session_id}` → 200 `{session_id, status:"returned"}` | 404 | 409 | 502.

- [ ] **Step 1: Port seam.ts**

`api/src/seam.ts` is `supabase/functions/_shared/seam.ts` with mechanical substitutions only: `Deno.env.get("X") ?? d` → `env.X` (import from `./env.js`), everything else (poll loop, timeouts, result shape) identical.

- [ ] **Step 2: Write failing tests (with an in-test mock Seam server)**

`api/test/borrow.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

let seamFail = false;
let mock: Server;

function startMockSeam(port: number) {
  mock = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/locks/unlock_door")
        return res.end(JSON.stringify({ action_attempt: { action_attempt_id: "a1", status: "pending" } }));
      if (req.url === "/action_attempts/get")
        return res.end(JSON.stringify({ action_attempt: seamFail
          ? { action_attempt_id: "a1", status: "error", error: { message: "mock fail" } }
          : { action_attempt_id: "a1", status: "success" } }));
      res.statusCode = 404; res.end("{}");
    });
  }).listen(port);
}

describe("borrow/return", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let cookie: string; let goproId: string;
  beforeAll(async () => {
    process.env.SEAM_API_URL = "http://127.0.0.1:9912";
    startMockSeam(9912);
    await resetDb(); app = await buildServer();
    const res = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "u@o.ai", password: "pw12345678" } });
    cookie = res.cookies.find((c) => c.name === "rack_session")!.value;
    goproId = (await pool.query(`select id from item_types where name = 'GoPro 13 Black'`)).rows[0].id;
  });
  afterAll(() => mock.close());

  const borrow = (body: object) => app.inject({ method: "POST", url: "/api/borrow",
    payload: body, cookies: { rack_session: cookie } });

  it("skips unlock when no lock is paired", async () => {
    const res = await borrow({ item_type_id: goproId });
    expect(res.statusCode).toBe(200);
    expect(res.json().unlock).toBe("skipped");
  });
  it("unlocks via Seam when a lock is paired, and returns work", async () => {
    await pool.query(`update locks set seam_device_id = 'dev-1'`);
    const res = await borrow({ item_type_id: goproId });
    expect(res.json().unlock).toBe("ok");
    const events = await pool.query(
      `select count(*)::int n from device_events where borrow_session_id = $1`,
      [res.json().session_id]);
    expect(events.rows[0].n).toBe(2);
    const ret = await app.inject({ method: "POST", url: "/api/return",
      payload: { session_id: res.json().session_id }, cookies: { rack_session: cookie } });
    expect(ret.json().status).toBe("returned");
  });
  it("cancels the session when Seam fails (502)", async () => {
    seamFail = true;
    const res = await borrow({ item_type_id: goproId });
    expect(res.statusCode).toBe(502);
    const c = await pool.query(`select count(*)::int n from borrow_sessions where status = 'cancelled'`);
    expect(c.rows[0].n).toBe(1);
    seamFail = false;
  });
  it("409 when no units available", async () => {
    const oculus = (await pool.query(`select id from item_types where name = 'Oculus'`)).rows[0].id;
    await borrow({ item_type_id: oculus });
    expect((await borrow({ item_type_id: oculus })).statusCode).toBe(409);
  });
});
```

- [ ] **Step 3: Run to verify failure** — expect 404s.

- [ ] **Step 4: Implement routes**

`api/src/routes/borrow.ts` — port of the two edge functions, same orchestration:
```ts
import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser } from "../auth.js";
import { unlockDoor } from "../seam.js";

async function lockForUnit(itemUnitId: string) {
  const { rows } = await query(`
    select l.id, l.seam_device_id from item_units u
    join locks l on l.cabinet_id = u.cabinet_id
    where u.id = $1 and l.is_active and l.seam_device_id is not null
    limit 1`, [itemUnitId]);
  return rows[0] ?? null;
}

async function logEvent(e: { lock_id?: string; session_id: string; user_id: string;
  type: "unlock_requested" | "unlock_succeeded" | "unlock_failed";
  attemptId?: string | null; detail?: object }) {
  await query(`
    insert into device_events (lock_id, borrow_session_id, actor_user_id, event_type, seam_action_attempt_id, detail)
    values ($1, $2, $3, $4, $5, $6)`,
    [e.lock_id ?? null, e.session_id, e.user_id, e.type, e.attemptId ?? null,
     JSON.stringify(e.detail ?? {})]);
}

export async function borrowRoutes(app: FastifyInstance) {
  app.post<{ Body: { item_type_id?: string; days?: number } }>(
    "/api/borrow", { preHandler: requireUser }, async (req, reply) => {
      const { item_type_id, days } = req.body ?? {};
      if (!item_type_id) return reply.code(400).send({ error: "item_type_id is required" });
      let session;
      try {
        const { rows } = await query(`select * from borrow_unit($1, $2, $3)`,
          [req.user!.id, item_type_id, days ?? 7]);
        session = rows[0];
      } catch (e: any) {
        const status = /no units available/.test(e.message) ? 409 : 400;
        return reply.code(status).send({ error: e.message.replace(/^.*?: /, "") });
      }
      const lock = await lockForUnit(session.item_unit_id);
      if (!lock) {
        await logEvent({ session_id: session.session_id, user_id: req.user!.id,
          type: "unlock_requested", detail: { skipped: true, reason: "no active Seam lock configured for cabinet" } });
        return { ...session, unlock: "skipped" };
      }
      await logEvent({ lock_id: lock.id, session_id: session.session_id,
        user_id: req.user!.id, type: "unlock_requested" });
      const unlock = await unlockDoor(lock.seam_device_id);
      await logEvent({ lock_id: lock.id, session_id: session.session_id,
        user_id: req.user!.id, type: unlock.ok ? "unlock_succeeded" : "unlock_failed",
        attemptId: unlock.actionAttemptId, detail: unlock.ok ? {} : { error: unlock.error } });
      if (!unlock.ok) {
        await query(`select cancel_borrow_session($1)`, [session.session_id]);
        return reply.code(502).send({ error: "cabinet did not unlock — item not checked out, please retry" });
      }
      return { ...session, unlock: "ok" };
    });

  app.post<{ Body: { session_id?: string } }>(
    "/api/return", { preHandler: requireUser }, async (req, reply) => {
      const { session_id } = req.body ?? {};
      if (!session_id) return reply.code(400).send({ error: "session_id is required" });
      const { rows } = await query(
        `select id, status, item_unit_id, user_id from borrow_sessions where id = $1`, [session_id]);
      const session = rows[0];
      if (!session || (session.user_id !== req.user!.id && req.user!.role !== "admin"))
        return reply.code(404).send({ error: "session not found" });
      if (session.status !== "active")
        return reply.code(409).send({ error: "session is not active" });
      const lock = await lockForUnit(session.item_unit_id);
      if (lock) {
        await logEvent({ lock_id: lock.id, session_id: session.id, user_id: req.user!.id,
          type: "unlock_requested", detail: { purpose: "return" } });
        const unlock = await unlockDoor(lock.seam_device_id);
        await logEvent({ lock_id: lock.id, session_id: session.id, user_id: req.user!.id,
          type: unlock.ok ? "unlock_succeeded" : "unlock_failed",
          attemptId: unlock.actionAttemptId,
          detail: unlock.ok ? { purpose: "return" } : { purpose: "return", error: unlock.error } });
        if (!unlock.ok)
          return reply.code(502).send({ error: "cabinet did not unlock — item still checked out, please retry" });
      }
      await query(`select mark_returned($1, $2, $3)`,
        [session.id, req.user!.id, req.user!.role === "admin"]);
      return { session_id: session.id, status: "returned" };
    });
}
```
Register in `server.ts`.

- [ ] **Step 5: Run tests to verify pass** — expect PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add api
git commit -m "feat: borrow/return routes with Seam unlock and cancel-on-failure"
```

---

### Task 6: Admin routes

**Files:**
- Create: `api/src/routes/admin.ts`, `api/test/admin.test.ts`
- Modify: `api/src/server.ts` (register)

**Interfaces:**
- Consumes: `requireAdmin` (Task 3), `mark_returned` (Task 2).
- Produces: `GET /api/admin/borrows` → `{active: active_borrows rows (all users), history: last 100 non-active sessions with user email + item name}`; `POST /api/admin/return {session_id}` (no unlock); `GET /api/admin/item-types` (types + their units); `POST /api/admin/item-types {name, category, notes?}`; `PATCH /api/admin/item-types/:id {name?, category?, notes?}`; `POST /api/admin/item-units {item_type_id, count?, asset_id?, notes?}` (creates `count` units, default 1); `PATCH /api/admin/item-units/:id {status?, asset_id?, owner?, notes?}` (status transitions validated: cannot set `available` while an active session exists for the unit → 409).

- [ ] **Step 1: Write failing tests**

`api/test/admin.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

describe("admin", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let admin: string; let user: string;
  beforeAll(async () => {
    await resetDb(); app = await buildServer();
    const u = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "u@o.ai", password: "pw12345678" } });
    user = u.cookies.find((c) => c.name === "rack_session")!.value;
    const a = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "a@o.ai", password: "pw12345678" } });
    admin = a.cookies.find((c) => c.name === "rack_session")!.value;
    await pool.query(`update profiles set role = 'admin' where email = 'a@o.ai'`);
  });

  it("blocks non-admins with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/borrows",
      cookies: { rack_session: user } });
    expect(res.statusCode).toBe(403);
  });
  it("admin return closes another user's session without unlock", async () => {
    const t = await pool.query(`select id from item_types where name = 'Tripod'`);
    const b = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t.rows[0].id }, cookies: { rack_session: user } });
    const res = await app.inject({ method: "POST", url: "/api/admin/return",
      payload: { session_id: b.json().session_id }, cookies: { rack_session: admin } });
    expect(res.json().status).toBe("returned");
  });
  it("creates units to fix a SEED-TODO type", async () => {
    const t = await pool.query(`select id from item_types where name = 'MacBook Air'`);
    const res = await app.inject({ method: "POST", url: "/api/admin/item-units",
      payload: { item_type_id: t.rows[0].id, count: 2 }, cookies: { rack_session: admin } });
    expect(res.statusCode).toBe(200);
    const avail = await pool.query(
      `select available_units::int a from item_availability where name = 'MacBook Air'`);
    expect(avail.rows[0].a).toBe(2);
  });
  it("rejects marking an in-use unit available", async () => {
    const t = await pool.query(`select id from item_types where name = 'Manus Gloves'`);
    const b = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t.rows[0].id }, cookies: { rack_session: user } });
    const res = await app.inject({ method: "PATCH",
      url: `/api/admin/item-units/${b.json().item_unit_id}`,
      payload: { status: "available" }, cookies: { rack_session: admin } });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify failure** — expect 404/failures.

- [ ] **Step 3: Implement**

`api/src/routes/admin.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireAdmin } from "../auth.js";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/borrows", async () => {
    const active = await query(`select * from active_borrows order by is_overdue desc, due_at`);
    const history = await query(`
      select s.id as session_id, p.email, t.name as item_name, s.status,
             s.checked_out_at, s.returned_at
      from borrow_sessions s
      join profiles p on p.id = s.user_id
      join item_units u on u.id = s.item_unit_id
      join item_types t on t.id = u.item_type_id
      where s.status <> 'active' order by s.checked_out_at desc limit 100`);
    return { active: active.rows, history: history.rows };
  });

  app.post<{ Body: { session_id?: string } }>("/api/admin/return", async (req, reply) => {
    const { session_id } = req.body ?? {};
    if (!session_id) return reply.code(400).send({ error: "session_id is required" });
    try {
      await query(`select mark_returned($1, $2, true)`, [session_id, req.user!.id]);
    } catch (e: any) {
      if (/not found/.test(e.message)) return reply.code(404).send({ error: "session not found" });
      return reply.code(409).send({ error: "session is not active" });
    }
    return { session_id, status: "returned" };
  });

  app.get("/api/admin/item-types", async () => {
    const { rows } = await query(`
      select t.id, t.name, t.category, t.notes,
        coalesce(json_agg(json_build_object(
          'id', u.id, 'asset_id', u.asset_id, 'status', u.status,
          'owner', u.owner, 'notes', u.notes) order by u.created_at)
          filter (where u.id is not null), '[]') as units
      from item_types t left join item_units u on u.item_type_id = t.id
      group by t.id order by t.category, t.name`);
    return rows;
  });

  app.post<{ Body: { name?: string; category?: string; notes?: string } }>(
    "/api/admin/item-types", async (req, reply) => {
      const { name, category, notes } = req.body ?? {};
      if (!name || !category) return reply.code(400).send({ error: "name and category are required" });
      const { rows } = await query(
        `insert into item_types (name, category, notes) values ($1, $2, $3) returning *`,
        [name, category, notes ?? null]);
      return rows[0];
    });

  app.patch<{ Params: { id: string }; Body: { name?: string; category?: string; notes?: string } }>(
    "/api/admin/item-types/:id", async (req, reply) => {
      const { rows } = await query(`
        update item_types set
          name = coalesce($2, name), category = coalesce($3, category),
          notes = coalesce($4, notes)
        where id = $1 returning *`,
        [req.params.id, req.body?.name ?? null, req.body?.category ?? null, req.body?.notes ?? null]);
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      return rows[0];
    });

  app.post<{ Body: { item_type_id?: string; count?: number; asset_id?: string; notes?: string } }>(
    "/api/admin/item-units", async (req, reply) => {
      const { item_type_id, count = 1, asset_id, notes } = req.body ?? {};
      if (!item_type_id) return reply.code(400).send({ error: "item_type_id is required" });
      if (count < 1 || count > 100) return reply.code(400).send({ error: "count must be 1-100" });
      if (asset_id && count > 1) return reply.code(400).send({ error: "asset_id only valid with count=1" });
      const cabinet = await query(`select id from cabinets order by created_at limit 1`);
      const { rows } = await query(`
        insert into item_units (item_type_id, cabinet_id, asset_id, notes)
        select $1, $2, $3, $4 from generate_series(1, $5) returning id`,
        [item_type_id, cabinet.rows[0]?.id ?? null, asset_id ?? null, notes ?? null, count]);
      return { created: rows.length };
    });

  app.patch<{ Params: { id: string };
    Body: { status?: string; asset_id?: string; owner?: string; notes?: string } }>(
    "/api/admin/item-units/:id", async (req, reply) => {
      const { status, asset_id, owner, notes } = req.body ?? {};
      if (status === "available") {
        const active = await query(
          `select 1 from borrow_sessions where item_unit_id = $1 and status = 'active'`,
          [req.params.id]);
        if (active.rows[0])
          return reply.code(409).send({ error: "unit has an active borrow session — return it instead" });
      }
      const { rows } = await query(`
        update item_units set
          status = coalesce($2::unit_status, status), asset_id = coalesce($3, asset_id),
          owner = coalesce($4, owner), notes = coalesce($5, notes)
        where id = $1 returning *`,
        [req.params.id, status ?? null, asset_id ?? null, owner ?? null, notes ?? null]);
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      return rows[0];
    });
}
```
Register in `server.ts` with encapsulation so the hook doesn't leak: `await app.register(adminRoutes);` (Fastify plugin scoping keeps `preHandler` local to the plugin).

- [ ] **Step 4: Run tests to verify pass** — expect PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat: admin routes — borrows overview, return override, inventory CRUD"
```

---

### Task 7: Resend port + reminders + cron + dev trigger

**Files:**
- Create: `api/src/resend.ts`, `api/src/reminders.ts`, `api/test/reminders.test.ts`
- Modify: `api/src/server.ts` (dev trigger route), `api/src/index.ts` (start cron)

**Interfaces:**
- Consumes: `query` (Task 2), `env` (Task 1).
- Produces: `sendEmail({to, subject, html})` from `api/src/resend.ts` (port of `_shared/resend.ts`, `Deno.env` → `env`); `runReminders(): Promise<{overdue_sessions: number; users_emailed: number; failures: string[]}>` from `api/src/reminders.ts`; `startReminderCron()` scheduling daily 09:00 local; dev-only route `POST /api/dev/run-reminders` (404 in production).

- [ ] **Step 1: Write failing tests**

`api/test/reminders.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { buildServer } from "../src/server.js";
import { resetDb, pool } from "./helpers.js";

let sent: string[] = [];
let mock: Server;

describe("reminders", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => {
    process.env.RESEND_API_URL = "http://127.0.0.1:9913";
    mock = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        sent.push(JSON.parse(body).to[0]);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: "m1" }));
      });
    }).listen(9913);
    await resetDb(); app = await buildServer();
    const u = await app.inject({ method: "POST", url: "/api/auth/signup",
      payload: { email: "late@o.ai", password: "pw12345678" } });
    const cookie = u.cookies.find((c) => c.name === "rack_session")!.value;
    const t = await pool.query(`select id from item_types where name = 'Tripod'`);
    const b = await app.inject({ method: "POST", url: "/api/borrow",
      payload: { item_type_id: t.rows[0].id }, cookies: { rack_session: cookie } });
    await pool.query(`update borrow_sessions set due_at = now() - interval '2 days',
      checked_out_at = now() - interval '9 days' where id = $1`, [b.json().session_id]);
  });
  afterAll(() => mock.close());

  it("emails overdue users once, idempotently", async () => {
    const r1 = await app.inject({ method: "POST", url: "/api/dev/run-reminders" });
    expect(r1.json()).toMatchObject({ overdue_sessions: 1, users_emailed: 1 });
    expect(sent).toEqual(["late@o.ai"]);
    const r2 = await app.inject({ method: "POST", url: "/api/dev/run-reminders" });
    expect(r2.json()).toMatchObject({ overdue_sessions: 0, users_emailed: 0 });
    expect(sent).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — expect 404.

- [ ] **Step 3: Implement**

`api/src/reminders.ts` — port of `overdue-reminders/index.ts` body:
```ts
import cron from "node-cron";
import { query } from "./db.js";
import { sendEmail } from "./resend.js";

export async function runReminders() {
  const { rows } = await query(`
    select s.id, s.user_id, s.due_at, s.reminder_count, p.email, p.full_name,
           t.name as item_name
    from borrow_sessions s
    join profiles p on p.id = s.user_id
    join item_units u on u.id = s.item_unit_id
    join item_types t on t.id = u.item_type_id
    where s.status = 'active' and s.due_at < now()
      and (s.last_reminded_at is null or s.last_reminded_at < now() - interval '20 hours')`);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  let emailed = 0; const failures: string[] = [];
  for (const sessions of byUser.values()) {
    const { email, full_name } = sessions[0];
    const items = sessions.map((s) =>
      `<li>${s.item_name} — due ${new Date(s.due_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</li>`).join("");
    const result = await sendEmail({
      to: email,
      subject: `Rack: you have ${sessions.length} overdue item${sessions.length > 1 ? "s" : ""}`,
      html: `<p>Hi ${full_name ?? "there"},</p>
<p>The following borrowed equipment is overdue. Please return it to the cabinet:</p>
<ul>${items}</ul><p>— Rack</p>`,
    });
    if (result.ok) {
      emailed++;
      for (const s of sessions)
        await query(`update borrow_sessions set last_reminded_at = now(),
          reminder_count = $2 where id = $1`, [s.id, s.reminder_count + 1]);
    } else failures.push(email);
  }
  return { overdue_sessions: rows.length, users_emailed: emailed, failures };
}

export function startReminderCron() {
  cron.schedule("0 9 * * *", () => { void runReminders(); });
}
```

In `server.ts`, register the dev trigger (before static serving):
```ts
if (env.NODE_ENV !== "production") {
  app.post("/api/dev/run-reminders", async () => runReminders());
}
```
In `index.ts` after listen: `if (env.CRON_ENABLED) startReminderCron();`

- [ ] **Step 4: Run tests to verify pass** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat: overdue reminders — node-cron, Resend port, dev trigger, idempotent"
```

---

### Task 8: Static serving, Dockerfile, smoke test, remove supabase tree

**Files:**
- Create: `api/Dockerfile`, `web/dist/index.html` (placeholder until the frontend plan)
- Modify: `api/src/server.ts` (static + SPA fallback), `scripts/smoke-test.sh` (full rewrite), `README.md` (new run instructions), `scripts/mock-seam.ts` (no change — verify it still runs)
- Delete: `supabase/` directory, `scripts/seed-dev-users.ts` stays.

**Interfaces:**
- Consumes: everything prior.
- Produces: `GET /` serves `web/dist`; unknown non-`/api` paths fall back to `index.html`. `scripts/smoke-test.sh` exercising the full API.

- [ ] **Step 1: Static serving in server.ts**

```ts
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
// inside buildServer(), after routes:
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });
}
```
`web/dist/index.html` placeholder: `<h1>Rack — frontend coming in phase 2</h1>`. Add `web/dist/` is NOT gitignored yet (placeholder committed); the frontend plan will gitignore it and build for real.

- [ ] **Step 2: Dockerfile**

`api/Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# migrations + seed + web assets live outside api/; compose mounts them
CMD ["node", "dist/index.js"]
```
In `docker-compose.yml` api service add:
```yaml
    volumes:
      - ./db:/db:ro
      - ./web/dist:/web/dist:ro
    environment:
      DATABASE_URL: postgresql://rack:rack@db:5432/rack
      MIGRATIONS_DIR: /db/migrations
      WEB_DIST: /web/dist
```
Support both overrides: in `migrate.ts` use `process.env.MIGRATIONS_DIR ?? DEFAULT_DIR`; in `server.ts` use `process.env.WEB_DIST ?? webDist`. In `index.ts`, run `runMigrations(pool)` before `listen`.

- [ ] **Step 3: Rewrite smoke-test.sh**

Replace the Supabase version wholesale. Same check style/counters, cookie auth via curl jars:
```bash
#!/usr/bin/env bash
# E2E smoke test for the self-hosted API. Prereqs:
#   docker compose up -d db
#   (cd api && npm run migrate -- --seed) && npx tsx scripts/seed-dev-users.ts
#   deno run --allow-net --allow-env scripts/mock-seam.ts 9911 &
#   SEAM_API_URL=http://127.0.0.1:9911 RESEND_API_URL=http://127.0.0.1:9911 \
#     NODE_ENV=development npm --prefix api run dev &
#   ./scripts/smoke-test.sh
set -uo pipefail
API=${API:-http://127.0.0.1:3000}
PSQL=${PSQL_BIN:-docker compose exec -T db psql -U rack rack}
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok: $1";
  else FAIL=$((FAIL+1)); echo "  FAIL: $1 (expected $2, got $3)"; fi; }
sql() { $PSQL -tA -c "$1"; }
jqv() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],j);console.log(Array.isArray(v)?v.length:v??"")}catch{console.log("")}})' "$1"; }

UJ=$(mktemp); AJ=$(mktemp)   # cookie jars
echo "== Auth"
curl -sc "$UJ" "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"user@rack.local","password":"password123"}' >/dev/null
curl -sc "$AJ" "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@rack.local","password":"password123"}' >/dev/null
check "user session works" "user@rack.local" "$(curl -sb "$UJ" "$API/api/me" | jqv email)"
check "unauthenticated is 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/me")"

echo "== Browse + authz"
check "28 item types" "28" "$(curl -sb "$UJ" "$API/api/availability" | jqv '')"
check "non-admin blocked from admin routes" "403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$UJ" "$API/api/admin/borrows")"

echo "== Borrow happy path (mock Seam)"
sql "update locks set seam_device_id = 'mock-device-1' where name = 'Main cabinet TTLock';" >/dev/null
GOPRO=$(sql "select id from item_types where name = 'GoPro 13 Black';")
B=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$GOPRO\"}")
S1=$(echo "$B" | jqv session_id)
check "borrow returns session" "yes" "$([ -n "$S1" ] && echo yes || echo no)"
check "unlock ok" "ok" "$(echo "$B" | jqv unlock)"
check "2 audit events" "2" "$(sql "select count(*) from device_events where borrow_session_id='$S1';")"

echo "== Race: 2 concurrent borrows, 1 unit"
OCULUS=$(sql "select id from item_types where name = 'Oculus';")
R1=$(mktemp); R2=$(mktemp)
curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$OCULUS\"}" > "$R1" &
curl -sb "$AJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$OCULUS\"}" > "$R2" &
wait
check "exactly one wins" "1" "$(cat "$R1" "$R2" | grep -c session_id)"
check "exactly one 'no units available'" "1" "$(cat "$R1" "$R2" | grep -c 'no units available')"

echo "== Return"
RET=$(curl -sb "$UJ" "$API/api/return" -H 'Content-Type: application/json' -d "{\"session_id\":\"$S1\"}")
check "return succeeds" "returned" "$(echo "$RET" | jqv status)"

echo "== Reminders (idempotent)"
B2=$(curl -sb "$UJ" "$API/api/borrow" -H 'Content-Type: application/json' -d "{\"item_type_id\":\"$GOPRO\"}")
S2=$(echo "$B2" | jqv session_id)
sql "update borrow_sessions set due_at = now() - interval '2 days', checked_out_at = now() - interval '9 days' where id = '$S2';" >/dev/null
check "first run emails 1" "1" "$(curl -s -X POST "$API/api/dev/run-reminders" | jqv users_emailed)"
check "second run emails 0" "0" "$(curl -s -X POST "$API/api/dev/run-reminders" | jqv users_emailed)"

echo; echo "== Results: $PASS passed, $FAIL failed"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
```
Seam-failure mode stays available: run the mock with `MOCK_SEAM_FAIL=1` and manually borrow → expect 502 + cancelled session (documented in README, not scripted — matches previous behavior).

- [ ] **Step 4: Run the full smoke test locally**

Follow the prereq comments in the script. Expected: `Results: 12 passed, 0 failed`.

- [ ] **Step 5: Remove the Supabase tree + update README**

```bash
git rm -r supabase
```
Rewrite README sections: architecture (Fastify + Postgres, two containers), local dev (`docker compose up -d db`, `npm run migrate -- --seed`, `seed-dev-users`, `npm run dev`, mock seam, smoke test), secrets table (drop CRON_SECRET — cron is in-process now; add SESSION_SECRET), production (office box: `docker compose --profile prod up -d`, nightly `pg_dump` host-cron one-liner: `0 3 * * * docker compose -f /path/to/rack/docker-compose.yml exec -T db pg_dump -U rack rack > /path/to/rack/db/backups/rack-$(date +\%F).sql`), TTLock/Seam pairing unchanged, first admin: `docker compose exec db psql -U rack rack -c "update profiles set role='admin' where email='...'"`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: static serving, Dockerfile, ported smoke test; remove supabase tree"
```

---

## Self-Review (completed)

- **Spec coverage:** every route in the spec's API table has a task (1–8); reminders/cron (7), compose+backups (8), seed conventions (2/3), smoke-test parity list (8). Frontend is explicitly a separate plan.
- **Placeholder scan:** none — all steps carry code or exact commands.
- **Type consistency:** `borrow_unit(p_user_id, p_item_type_id, p_days)` matches Tasks 2/5; `mark_returned(p_session_id, p_user_id, p_is_admin)` matches Tasks 2/5/6; `unlockDoor` result shape matches Task 5's usage; cookie name `rack_session` consistent across 3–8.
