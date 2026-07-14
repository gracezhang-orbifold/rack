-- Condition reports on return: the borrower says whether the item came back
-- damaged (with a description). A damaged return parks the unit in
-- needs_repair instead of releasing it back to the pool.

alter table public.borrow_sessions add column return_damaged boolean;
alter table public.borrow_sessions add column return_note text;

-- Replace mark_returned with condition parameters. Dropped first because
-- adding defaulted parameters would otherwise create a second overload.
drop function public.mark_returned(uuid, uuid, boolean);

create function public.mark_returned(
  p_session_id uuid, p_user_id uuid, p_is_admin boolean,
  p_damaged boolean default false, p_note text default null)
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
      return_damaged = coalesce(p_damaged, false), return_note = p_note
  where id = p_session_id;
  update public.item_units
  set status = case when coalesce(p_damaged, false)
                    then 'needs_repair'::public.unit_status
                    else 'available'::public.unit_status end
  where id = v_session.item_unit_id;
end; $$;
