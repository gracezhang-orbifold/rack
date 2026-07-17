# Admin account management — design

## Problem

Signup always creates `role = 'user'`; the only admin is the seeded one, and
promoting anyone means hand-editing the database.

## Design

Two paths to the admin role, both managed from a new admin **People** page:

### Allowlist (admin-on-signup)

- Migration `013_admin_allowlist.sql`: table `admin_allowlist`
  (`email text primary key`, `created_at timestamptz default now()`).
  Emails stored lowercased/trimmed.
- Signup (`POST /api/auth/signup`): if the email is on the allowlist, create
  the account with `role = 'admin'` and delete the allowlist row (the list
  holds only *pending* admins — a consumed entry never fights a later
  demotion).

### Role management

All endpoints behind `requireAdmin`:

- `GET /api/admin/users` → `[{ id, email, full_name, role, created_at }]`,
  ordered by creation.
- `PATCH /api/admin/users/:id` body `{ role: "admin" | "user" }`.
  - 400 unknown role; 404 unknown id (incl. 22P02 malformed uuid).
  - 409 when targeting your own account ("you cannot change your own role").
  - 409 when demoting the last remaining admin ("cannot demote the last admin").
- `GET /api/admin/allowlist` → `[{ email, created_at }]`.
- `POST /api/admin/allowlist` body `{ email }` — idempotent on repeats
  (upsert); 409 if a profile with that email already exists (promote them
  instead); 400 empty/invalid email.
- `DELETE /api/admin/allowlist/:email` — 404 if absent.

### UI

- Sidebar (admin section) + route: **People** → `/admin/people`.
- Members section: table of users (name, email, role badge,
  Promote/Demote button; no button on the signed-in admin's own row).
- Pending admin invites section: add-email input + list with Remove;
  copy notes the role activates when that person signs up.

### Testing

- Smoke test: allowlist add → signup → role is admin → entry consumed;
  self-demotion 409; last-admin demotion 409; duplicate allowlist add OK;
  allowlist add for existing user 409. Cleanup removes `smoke-*` accounts
  and allowlist rows.
- Web vitest: People screen renders members + invites; Promote sends PATCH;
  own row has no role button; add/remove invite calls API.
