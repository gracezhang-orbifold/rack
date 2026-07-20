-- Reminders can be delivered by web push instead of email. The channel is a
-- per-user preference; subscriptions are per-browser (a user may have several
-- devices), keyed by the push service endpoint.
alter table public.profiles add column reminder_channel text not null default 'email'
  constraint reminder_channel_valid check (reminder_channel in ('email', 'push'));

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions(user_id);
