-- Cron della copia da Google Calendar (28.10.2026, tappa 1): ogni 10 minuti; la funzione lavora solo dalle 6 alle 23
-- di Zurigo. Si accende dopo la prova a secco e dopo il prompt nuovo dell'agente calendario.
select cron.unschedule('calendario-copia') where exists (select 1 from cron.job where jobname = 'calendario-copia');
select cron.schedule('calendario-copia', '1,11,21,31,41,51 * * * *', $cron$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/calendario-copia',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$cron$);
