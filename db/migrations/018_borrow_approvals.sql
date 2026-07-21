-- Checkout approval layer. Every checkout is backed by an approval record;
-- the mode decides whether approval is granted instantly (auto) or waits for
-- an admin (manual). Currently auto.
create table public.app_settings (
  key text primary key,
  value text not null
);
insert into public.app_settings (key, value) values ('borrow_approval_mode', 'auto');

create table public.borrow_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  item_type_id uuid not null references public.item_types(id),
  -- pending → approved/denied (admin) → used (consumed by a checkout).
  -- Auto mode inserts straight to 'used' with auto_approved = true.
  status text not null default 'pending'
    constraint borrow_approval_status check (status in ('pending', 'approved', 'denied', 'used')),
  auto_approved boolean not null default false,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id)
);
create index borrow_approvals_pending on public.borrow_approvals(status) where status = 'pending';
create index borrow_approvals_user on public.borrow_approvals(user_id, item_type_id);
