-- After unlocking, the borrower scans the QR label on the item they actually
-- took. borrow_unit claims an arbitrary unit of the type; the scan rebinds the
-- session to the physical unit if they differ, so the database matches reality.

alter table public.borrow_sessions add column unit_confirmed_at timestamptz;

-- Scan-first checkouts (p_unit_id given) already know their exact unit, so
-- they are born confirmed.
create or replace function public.borrow_unit(
  p_user_id uuid, p_item_type_id uuid, p_days int default 7, p_unit_id uuid default null)
returns table (session_id uuid, item_unit_id uuid, due_at timestamptz)
language plpgsql as $$
declare
  v_unit_id uuid;
  v_session public.borrow_sessions;
begin
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'p_days must be between 1 and 90' using errcode = '22023';
  end if;
  if p_unit_id is not null then
    select u.id into v_unit_id from public.item_units u
    where u.id = p_unit_id and u.item_type_id = p_item_type_id and u.status = 'available'
    for update skip locked;
    if v_unit_id is null then
      raise exception 'this unit is not available' using errcode = 'P0002';
    end if;
  else
    select u.id into v_unit_id from public.item_units u
    where u.item_type_id = p_item_type_id and u.status = 'available'
    order by u.created_at limit 1 for update skip locked;
    if v_unit_id is null then
      raise exception 'no units available for this item type' using errcode = 'P0002';
    end if;
  end if;
  update public.item_units set status = 'in_use' where id = v_unit_id;
  insert into public.borrow_sessions (user_id, item_unit_id, due_at, unit_confirmed_at)
  values (p_user_id, v_unit_id, now() + make_interval(days => p_days),
          case when p_unit_id is not null then now() end)
  returning * into v_session;
  return query select v_session.id, v_session.item_unit_id, v_session.due_at;
end; $$;

-- Bind an active session to the unit whose label was scanned. If it differs
-- from the claimed unit, swap them atomically: scanned unit goes in_use, the
-- originally claimed one is released.
create function public.confirm_borrow_unit(p_session_id uuid, p_user_id uuid, p_unit_id uuid)
returns table (session_id uuid, item_unit_id uuid)
language plpgsql as $$
declare
  v_session public.borrow_sessions;
  v_rec public.item_units;
  v_old public.item_units;
  v_new public.item_units;
begin
  select * into v_session from public.borrow_sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.user_id <> p_user_id then
    raise exception 'not allowed to confirm this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active' then
    raise exception 'session is not active' using errcode = 'P0001';
  end if;

  if v_session.item_unit_id = p_unit_id then
    update public.borrow_sessions set unit_confirmed_at = now() where id = p_session_id;
    return query select p_session_id, p_unit_id;
    return;
  end if;

  -- Lock both units in a stable order to avoid deadlocks between concurrent swaps.
  for v_rec in
    select * from public.item_units where id in (v_session.item_unit_id, p_unit_id)
    order by id for update
  loop
    if v_rec.id = p_unit_id then v_new := v_rec; else v_old := v_rec; end if;
  end loop;
  if v_new.id is null then raise exception 'unit not found' using errcode = 'P0002'; end if;
  if v_new.item_type_id <> v_old.item_type_id then
    raise exception 'scanned label belongs to a different item type' using errcode = 'P0001';
  end if;
  if v_new.status <> 'available' then
    raise exception 'this unit is not available' using errcode = 'P0001';
  end if;

  update public.item_units set status = 'in_use' where id = v_new.id;
  update public.item_units set status = 'available' where id = v_old.id;
  update public.borrow_sessions
  set item_unit_id = v_new.id, unit_confirmed_at = now() where id = p_session_id;
  return query select p_session_id, v_new.id;
end; $$;
