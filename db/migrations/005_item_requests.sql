-- Requests against unavailable items: waitlist queue, one-shot availability
-- notifications, and dated reservations. One table, discriminated by kind —
-- they share lifecycle, ownership, and per-item uniqueness.

create type public.request_kind as enum ('waitlist', 'notify', 'reservation');
create type public.request_status as enum ('active', 'fulfilled', 'cancelled');

create table public.item_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id),
  item_type_id  uuid not null references public.item_types (id),
  kind          public.request_kind not null,
  status        public.request_status not null default 'active',
  start_at      timestamptz,  -- reservations: when the user wants the item
  days          int,          -- reservations: how long they want it
  created_at    timestamptz not null default now(),
  notified_at   timestamptz,
  constraint reservation_fields check (
    (kind = 'reservation') = (start_at is not null and days is not null)),
  constraint reservation_days check (days is null or (days >= 1 and days <= 90))
);

-- One live request per user/item/kind; queue order comes from created_at.
create unique index item_requests_one_active_idx
  on public.item_requests (user_id, item_type_id, kind) where status = 'active';
create index item_requests_type_status_idx
  on public.item_requests (item_type_id, status);
