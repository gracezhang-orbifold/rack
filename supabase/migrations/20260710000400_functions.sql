-- State transitions live in SECURITY DEFINER functions so clients never write
-- borrow_sessions or item_units directly; the claim is atomic in one transaction.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Claim an available unit of the requested type and open a borrow session.
-- FOR UPDATE SKIP LOCKED: concurrent borrowers get different units, or a clean
-- "none available" — no blocking, no double-claim.
create or replace function public.borrow_unit(p_item_type_id uuid, p_days int default 7)
returns table (session_id uuid, item_unit_id uuid, due_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_id uuid;
  v_session public.borrow_sessions;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'p_days must be between 1 and 90' using errcode = '22023';
  end if;

  select u.id into v_unit_id
  from public.item_units u
  where u.item_type_id = p_item_type_id
    and u.status = 'available'
  order by u.created_at
  limit 1
  for update skip locked;

  if v_unit_id is null then
    raise exception 'no units available for this item type' using errcode = 'P0002';
  end if;

  update public.item_units set status = 'in_use' where id = v_unit_id;

  insert into public.borrow_sessions (user_id, item_unit_id, due_at)
  values (auth.uid(), v_unit_id, now() + make_interval(days => p_days))
  returning * into v_session;

  return query select v_session.id, v_session.item_unit_id, v_session.due_at;
end;
$$;

-- Close a session and free its unit. Owner or admin only.
create or replace function public.mark_returned(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.borrow_sessions;
begin
  select * into v_session
  from public.borrow_sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if v_session.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'not allowed to return this session' using errcode = '42501';
  end if;

  if v_session.status <> 'active' then
    raise exception 'session is not active' using errcode = 'P0001';
  end if;

  update public.borrow_sessions
  set status = 'returned', returned_at = now()
  where id = p_session_id;

  update public.item_units set status = 'available' where id = v_session.item_unit_id;
end;
$$;

-- Compensation when the Seam unlock fails after the session was created.
-- Service-role only (execute revoked from authenticated below).
create or replace function public.cancel_borrow_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.borrow_sessions;
begin
  select * into v_session
  from public.borrow_sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  if v_session.status <> 'active' then
    raise exception 'session is not active' using errcode = 'P0001';
  end if;

  update public.borrow_sessions set status = 'cancelled' where id = p_session_id;
  update public.item_units set status = 'available' where id = v_session.item_unit_id;
end;
$$;

-- Grants: everything is opt-in per function.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.borrow_unit(uuid, int) from public, anon;
grant execute on function public.borrow_unit(uuid, int) to authenticated;

revoke execute on function public.mark_returned(uuid) from public, anon;
grant execute on function public.mark_returned(uuid) to authenticated;

revoke execute on function public.cancel_borrow_session(uuid) from public, anon, authenticated;
