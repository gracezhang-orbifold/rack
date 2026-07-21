-- Checkout requests now happen up front (Browse → "Request approval") and the
-- actual unlock happens later from My Assets, so the approval must carry the
-- checkout parameters. Users can also cancel a request they no longer want.
alter table public.borrow_approvals add column days int;
alter table public.borrow_approvals add column duration_seconds int;
alter table public.borrow_approvals add column with_accessory boolean not null default false;

alter table public.borrow_approvals drop constraint borrow_approval_status;
alter table public.borrow_approvals add constraint borrow_approval_status
  check (status in ('pending', 'approved', 'denied', 'used', 'cancelled'));
