-- Deadline extensions and per-user reminder preferences.

-- How many days before the due date to send a heads-up email (0 = none), and
-- how often to repeat overdue reminders (in days; 0 = never). Defaults match
-- the previous hard-coded behavior: no pre-due email, daily overdue nags.
alter table public.profiles add column remind_before_days int not null default 1
  constraint remind_before_days_range check (remind_before_days between 0 and 14);
alter table public.profiles add column overdue_reminder_every_days int not null default 1
  constraint overdue_reminder_range check (overdue_reminder_every_days between 0 and 30);

-- One heads-up per deadline: stamped when the pre-due email sends, cleared
-- when the deadline moves (extension).
alter table public.borrow_sessions add column pre_reminded_at timestamptz;

-- Push an active session's due date out. Owner only; total loan length stays
-- capped at 90 days from checkout.
create function public.extend_borrow(p_session_id uuid, p_user_id uuid, p_days int)
returns table (session_id uuid, due_at timestamptz)
language plpgsql as $$
declare
  v_session public.borrow_sessions;
  v_due timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'p_days must be between 1 and 30' using errcode = '22023';
  end if;
  select * into v_session from public.borrow_sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.user_id <> p_user_id then
    raise exception 'not allowed to extend this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active' then raise exception 'session is not active' using errcode = 'P0001'; end if;
  -- Computed into a variable because the OUT column `due_at` would otherwise
  -- make `set due_at = due_at + …` ambiguous inside this function.
  v_due := v_session.due_at + make_interval(days => p_days);
  if v_due > v_session.checked_out_at + interval '90 days' then
    raise exception 'cannot extend beyond 90 days from checkout' using errcode = 'P0001';
  end if;
  update public.borrow_sessions
  set due_at = v_due, pre_reminded_at = null
  where id = p_session_id;
  return query select v_session.id, v_due;
end; $$;
