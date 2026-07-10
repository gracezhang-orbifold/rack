-- Daily overdue-reminder job. The function URL and cron secret come from
-- Supabase Vault so this migration is environment-agnostic:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random string>', 'cron_secret');
--
-- If the Vault entries are missing (e.g. a fresh local reset), the job is
-- still scheduled and simply no-ops with a notice until they are created.

select cron.schedule(
  'overdue-reminders',
  '0 16 * * *',  -- 16:00 UTC = 9am PT (PDT); shifts to 8am PST in winter
  $$
  do $job$
  declare
    v_url text;
    v_secret text;
  begin
    select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

    if v_url is null or v_secret is null then
      raise notice 'overdue-reminders: vault secrets project_url/cron_secret not set; skipping';
      return;
    end if;

    perform net.http_post(
      url := v_url || '/functions/v1/overdue-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  end;
  $job$;
  $$
);
