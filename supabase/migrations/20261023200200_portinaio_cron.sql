-- Il portinaio gira ogni 10 minuti, giorno e notte (l'ora di Zurigo la controlla la funzione: così il cambio
-- dell'ora legale non sposta niente). Minuti sfalsati rispetto agli altri lavori. Acceso dopo la prova.
select cron.schedule('portinaio', '4,14,24,34,44,54 * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/portinaio',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$$);
