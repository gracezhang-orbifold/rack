-- Pending admin invites: emails here get role 'admin' at signup, and the
-- row is consumed (deleted) at that moment — the list never holds accounts
-- that already exist.
create table public.admin_allowlist (
  email      text primary key,
  created_at timestamptz not null default now()
);
