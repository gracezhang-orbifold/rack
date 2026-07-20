-- Hour-level checkouts need hour-level reminders: the pre-due lead time moves
-- from whole days to minutes (presets: 1 day / 1 hour / custom), and every
-- loan gets a one-time "now due" reminder stamped by due_reminded_at.
alter table public.profiles add column remind_before_minutes int not null default 1440
  constraint remind_before_minutes_range check (remind_before_minutes between 0 and 20160);
update public.profiles set remind_before_minutes = remind_before_days * 1440;
alter table public.profiles drop column remind_before_days;

alter table public.borrow_sessions add column due_reminded_at timestamptz;

-- Extending a loan moves the deadline, so both the heads-up and the due-now
-- reminder must re-arm for the new due date.
create or replace function public.extend_borrow(p_session_id uuid, p_user_id uuid, p_days int)
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
  set due_at = v_due, pre_reminded_at = null, due_reminded_at = null
  where id = p_session_id;
  return query select v_session.id, v_due;
end; $$;
