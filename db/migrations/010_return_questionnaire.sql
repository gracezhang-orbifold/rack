-- Per-item-type return questionnaire + admin attention queue.
-- Questions: [{ "id": "q1", "label": "…", "kind": "text" | "yes_no", "flag_if_yes": true }]
-- A flagged return does NOT hold the unit — it stays borrowable; the flag
-- lands in the attention queue (a query, not a table) until an admin
-- resolves it. Damaged still parks the unit in needs_repair (008).

alter table public.item_types
  add column return_questions jsonb not null default '[]'::jsonb;

alter table public.borrow_sessions add column return_answers jsonb;
alter table public.borrow_sessions add column return_flagged boolean not null default false;
alter table public.borrow_sessions add column attention_resolved_at timestamptz;
alter table public.borrow_sessions add column attention_resolved_by uuid references public.profiles(id);

-- Column appended so the view stays replaceable in place (009 pattern):
-- the return sheet needs the type's questions alongside each active borrow.
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
  (s.unit_confirmed_at is not null or u.asset_id is null) as unit_confirmed,
  t.return_questions
from public.borrow_sessions s
join public.profiles p on p.id = s.user_id
join public.item_units u on u.id = s.item_unit_id
join public.item_types t on t.id = u.item_type_id
where s.status = 'active';

-- Replace mark_returned with questionnaire parameters. Dropped first because
-- adding defaulted parameters would otherwise create a second overload.
drop function public.mark_returned(uuid, uuid, boolean, boolean, text);

create function public.mark_returned(
  p_session_id uuid, p_user_id uuid, p_is_admin boolean,
  p_damaged boolean default false, p_note text default null,
  p_answers jsonb default null, p_flagged boolean default false)
returns void language plpgsql as $$
declare v_session public.borrow_sessions;
begin
  select * into v_session from public.borrow_sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.user_id <> p_user_id and not p_is_admin then
    raise exception 'not allowed to return this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active' then raise exception 'session is not active' using errcode = 'P0001'; end if;
  update public.borrow_sessions
  set status = 'returned', returned_at = now(),
      return_damaged = coalesce(p_damaged, false), return_note = p_note,
      return_answers = p_answers, return_flagged = coalesce(p_flagged, false)
  where id = p_session_id;
  update public.item_units
  set status = case when coalesce(p_damaged, false)
                    then 'needs_repair'::public.unit_status
                    else 'available'::public.unit_status end
  where id = v_session.item_unit_id;
end; $$;
