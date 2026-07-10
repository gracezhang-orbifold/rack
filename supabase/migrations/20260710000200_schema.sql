-- Rack core schema: equipment lending with Seam-controlled smart cabinets.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('user', 'admin');

-- 'keybox' models the scalable option from the lock comparison sheet: a smart
-- lockbox holding keys to ordinary key-lock cabinets.
create type public.lock_kind as enum ('cabinet', 'keybox');

create type public.unit_status as enum
  ('available', 'in_use', 'needs_repair', 'retired', 'missing');

-- "overdue" is derived (status = 'active' and due_at < now()), never stored.
create type public.session_status as enum ('active', 'returned', 'cancelled');

create type public.device_event_type as enum
  ('unlock_requested', 'unlock_succeeded', 'unlock_failed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       public.user_role not null default 'user',
  created_at timestamptz not null default now()
);

create table public.cabinets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  location   text,
  notes      text,
  created_at timestamptz not null default now()
);

create table public.locks (
  id             uuid primary key default gen_random_uuid(),
  cabinet_id     uuid not null references public.cabinets (id),
  kind           public.lock_kind not null default 'cabinet',
  name           text not null,
  -- Null until the physical lock is paired via Seam Connect.
  seam_device_id text unique,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.item_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  category   text not null,
  notes      text,
  created_at timestamptz not null default now()
);

create table public.item_units (
  id            uuid primary key default gen_random_uuid(),
  item_type_id  uuid not null references public.item_types (id),
  asset_id      text unique,
  status        public.unit_status not null default 'available',
  cabinet_id    uuid references public.cabinets (id),
  owner         text,
  purchase_date date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index item_units_type_status_idx on public.item_units (item_type_id, status);

create table public.borrow_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id),
  item_unit_id        uuid not null references public.item_units (id),
  status              public.session_status not null default 'active',
  checked_out_at      timestamptz not null default now(),
  due_at              timestamptz not null,
  returned_at         timestamptz,
  last_reminded_at    timestamptz,
  reminder_count      int not null default 0,
  -- Reserved for the v2 time-bound keypad PIN flow.
  seam_access_code_id text,
  notes               text,
  constraint due_after_checkout check (due_at > checked_out_at),
  constraint returned_iff_status check ((returned_at is not null) = (status = 'returned'))
);

-- Backstop against double-borrowing: at most one active session per unit,
-- regardless of which code path inserts sessions.
create unique index one_active_session_per_unit
  on public.borrow_sessions (item_unit_id)
  where (status = 'active');

create index borrow_sessions_user_status_idx on public.borrow_sessions (user_id, status);
create index borrow_sessions_status_due_idx on public.borrow_sessions (status, due_at);

create table public.device_events (
  id                     uuid primary key default gen_random_uuid(),
  lock_id                uuid references public.locks (id),
  borrow_session_id      uuid references public.borrow_sessions (id),
  actor_user_id          uuid references public.profiles (id),
  event_type             public.device_event_type not null,
  seam_action_attempt_id text,
  detail                 jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);

create index device_events_created_idx on public.device_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger item_units_touch_updated_at
  before update on public.item_units
  for each row execute function public.touch_updated_at();
