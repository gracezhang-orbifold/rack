-- QR scan checkout: allow claiming a specific unit (scanned by asset id), and
-- expose asset ids on the availability view so items are searchable by them.

-- Replace borrow_unit with an optional p_unit_id. Dropped first because
-- adding a defaulted parameter would otherwise create a second overload.
drop function public.borrow_unit(uuid, uuid, int);

create function public.borrow_unit(
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
    -- Scanned checkout: claim exactly the unit on the label, or fail.
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
  insert into public.borrow_sessions (user_id, item_unit_id, due_at)
  values (p_user_id, v_unit_id, now() + make_interval(days => p_days))
  returning * into v_session;
  return query select v_session.id, v_session.item_unit_id, v_session.due_at;
end; $$;

-- Asset ids of non-retired units, for search. Appended column keeps the view
-- replaceable in place.
create or replace view public.item_availability
as
select
  t.id       as item_type_id,
  t.name,
  t.category,
  t.notes,
  count(u.id) filter (where u.status <> 'retired')      as total_units,
  count(u.id) filter (where u.status = 'available')     as available_units,
  count(u.id) filter (where u.status = 'in_use')        as in_use_units,
  count(u.id) filter (where u.status = 'needs_repair')  as needs_repair_units,
  count(u.id) filter (where u.status = 'missing')       as missing_units,
  coalesce(array_agg(u.asset_id) filter (where u.asset_id is not null and u.status <> 'retired'), '{}')
    as asset_ids
from public.item_types t
left join public.item_units u on u.item_type_id = t.id
group by t.id;
