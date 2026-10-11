-- Second Brain GF – Copia automatica delle note dal gestionale Ceramex (fase 2, tappa 2)
-- Ogni 10 minuti pg_cron chiama la funzione "copia-ceramex", che legge Ceramex con l'utente
-- di sola lettura "brain_lettore" e copia schede, note, regole e mail viste (stessi id).
-- L'esito va in copia_registro: l'app avvisa in Oggi se la copia non funziona.
-- La chiave "copia_token" sta nel Vault (creata a parte, non in questo file).

create table public.copia_registro (
  id           bigint generated always as identity primary key,
  iniziata_il  timestamptz not null,
  ok           boolean not null,
  dettagli     jsonb,
  errore       text
);
create index copia_registro_ok on public.copia_registro (ok, id desc);
alter table public.copia_registro enable row level security;
revoke all on public.copia_registro from anon, authenticated;
grant select on public.copia_registro to authenticated;
create policy "lettura per l'app" on public.copia_registro
  for select to authenticated using ((select auth.uid()) is not null);

-- Il registro tiene solo gli ultimi 7 giorni.
select cron.schedule(
  'copia-registro-pulizia',
  '15 3 * * *',
  $$ delete from public.copia_registro where iniziata_il < now() - interval '7 days' $$
);

select cron.schedule(
  'copia-ceramex',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/copia-ceramex',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
