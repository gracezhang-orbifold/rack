-- RLS: users browse inventory and see their own data; all state changes go
-- through the SECURITY DEFINER RPCs or the service role. Admins manage inventory.

alter table public.profiles        enable row level security;
alter table public.cabinets        enable row level security;
alter table public.locks           enable row level security;
alter table public.item_types      enable row level security;
alter table public.item_units      enable row level security;
alter table public.borrow_sessions enable row level security;
alter table public.device_events   enable row level security;

-- Explicit grants: objects created in migrations don't reliably receive the
-- platform's default privileges, so table access is granted here and RLS does
-- the row-level enforcement. anon gets nothing at all.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
revoke all on all tables in schema public from anon;

-- profiles -------------------------------------------------------------------

create policy "profiles: read own" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Non-admins may only change full_name; role/email edits are blocked here
-- because an UPDATE policy cannot compare old and new values.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role or new.email is distinct from old.email)
     and not public.is_admin()
     and auth.uid() is not null  -- service role and direct psql bypass this guard
  then
    raise exception 'only admins can change role or email' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- cabinets / item_types / item_units: browseable by all users, managed by admins

create policy "cabinets: read" on public.cabinets
  for select to authenticated using (true);
create policy "cabinets: admin write" on public.cabinets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "item_types: read" on public.item_types
  for select to authenticated using (true);
create policy "item_types: admin write" on public.item_types
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "item_units: read" on public.item_units
  for select to authenticated using (true);
create policy "item_units: admin write" on public.item_units
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- locks: Seam device IDs stay server-side; only admins (and the service role
-- inside edge functions) can see or manage them.

create policy "locks: admin only" on public.locks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- borrow_sessions: read own (admins read all); UPDATE for admin fix-ups only.
-- No INSERT/DELETE policies — writes happen inside SECURITY DEFINER RPCs.

create policy "borrow_sessions: read own" on public.borrow_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "borrow_sessions: admin update" on public.borrow_sessions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- device_events: audit log; admins read, only the service role writes.

create policy "device_events: admin read" on public.device_events
  for select to authenticated using (public.is_admin());
