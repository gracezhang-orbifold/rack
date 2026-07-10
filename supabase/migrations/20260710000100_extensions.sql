-- Extensions used by the overdue-reminder cron job.
-- Both ship with the Supabase platform (hosted and local stack).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
