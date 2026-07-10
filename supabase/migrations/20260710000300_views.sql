-- Availability is always computed from unit rows, never stored.
-- security_invoker so RLS on the underlying tables applies to the caller.

create view public.item_availability
with (security_invoker = true) as
select
  t.id       as item_type_id,
  t.name,
  t.category,
  t.notes,
  count(u.id) filter (where u.status <> 'retired')      as total_units,
  count(u.id) filter (where u.status = 'available')     as available_units,
  count(u.id) filter (where u.status = 'in_use')        as in_use_units,
  count(u.id) filter (where u.status = 'needs_repair')  as needs_repair_units,
  count(u.id) filter (where u.status = 'missing')       as missing_units
from public.item_types t
left join public.item_units u on u.item_type_id = t.id
group by t.id;

create view public.active_borrows
with (security_invoker = true) as
select
  s.id as session_id,
  s.user_id,
  p.email,
  p.full_name,
  u.id as item_unit_id,
  u.asset_id,
  t.name as item_name,
  t.category,
  s.checked_out_at,
  s.due_at,
  (s.due_at < now()) as is_overdue
from public.borrow_sessions s
join public.profiles p on p.id = s.user_id
join public.item_units u on u.id = s.item_unit_id
join public.item_types t on t.id = u.item_type_id
where s.status = 'active';
