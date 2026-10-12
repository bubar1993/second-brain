-- La funzione ordini-marazzi gira ogni 15 minuti (stesso token della copia Ceramex, nel Vault).
select cron.schedule('ordini-marazzi', '7,22,37,52 * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/ordini-marazzi',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
