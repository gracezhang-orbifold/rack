-- Surface whether a checkout's unit scan is still pending. Unlabeled units
-- count as confirmed — there is no label to scan. Column appended so the view
-- stays replaceable in place.

create or replace view public.active_borrows
as
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
  (s.due_at < now()) as is_overdue,
  (s.unit_confirmed_at is not null or u.asset_id is null) as unit_confirmed
from public.borrow_sessions s
join public.profiles p on p.id = s.user_id
join public.item_units u on u.id = s.item_unit_id
join public.item_types t on t.id = u.item_type_id
where s.status = 'active';
