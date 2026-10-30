create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'training-session-reminders-every-minute';

select cron.schedule(
  'training-session-reminders-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'training_reminder_project_url'
      ) || '/functions/v1/training-session-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'training_reminder_anon_key'
        ),
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'training_reminder_cron_secret'
        )
      ),
      body := jsonb_build_object('triggered_at', now())
    ) as request_id;
  $job$
);
