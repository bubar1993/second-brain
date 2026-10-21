-- Il guardiano gira ogni 15 minuti (minuti sfalsati rispetto agli altri lavori). Acceso dopo la prova.
select cron.schedule('guardiano', '2,17,32,47 * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/guardiano',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$$);
