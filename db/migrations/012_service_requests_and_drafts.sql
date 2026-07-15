-- Service requests: "something's wrong with this unit" raised by any user
-- from a scanned label, independent of any borrow session. Admins review
-- and resolve; unit status stays under the existing inventory controls.

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  item_unit_id uuid not null references public.item_units(id),
  user_id uuid not null references public.profiles(id),
  description text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz
);

-- Draft return answers: users may pre-answer return questions from My
-- Assets; the return sheet prefills from the draft for confirmation.
alter table public.borrow_sessions add column draft_answers jsonb;

-- Column appended so the view stays replaceable in place.
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
  t.return_questions,
  s.draft_answers
from public.borrow_sessions s
join public.profiles p on p.id = s.user_id
join public.item_units u on u.id = s.item_unit_id
join public.item_types t on t.id = u.item_type_id
where s.status = 'active';

-- Same signature -> create or replace; closing a session discards its draft.
create or replace function public.mark_returned(
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
      return_answers = p_answers, return_flagged = coalesce(p_flagged, false),
      draft_answers = null
  where id = p_session_id;
  update public.item_units
  set status = case when coalesce(p_damaged, false)
                    then 'needs_repair'::public.unit_status
                    else 'available'::public.unit_status end
  where id = v_session.item_unit_id;
end; $$;
