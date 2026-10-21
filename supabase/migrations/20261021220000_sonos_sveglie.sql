-- Sveglie Sonos (21.10.2026, scelte di Giovanni): saluto + meteo scherzoso + battuta (+ notizie per Giovanni),
-- detti da Laomedeia, poi un Preferito Sonos (playlist o artista Spotify). Le fa la funzione `sonos` (azione 'sveglie').
-- giorni: 1 = lunedì … 7 = domenica. Ora di Zurigo. salta_vacanze: niente sveglia nei giorni "Scuola chiusa" (eventi).
create table public.sonos_sveglie (
  id             serial primary key,
  nome           text not null,
  cassa          text not null,
  giorni         smallint[] not null,
  ora            time not null,
  saluto         text not null,
  per            text not null check (per in ('bambini', 'giovanni')),
  notizie        boolean not null default false,
  preferito      text,
  volume_voce    smallint not null default 25,
  volume_musica  smallint not null default 15,
  salta_vacanze  boolean not null default false,
  attiva         boolean not null default true,
  ultima_il      date,
  ultimo_testo   text,
  errore         text,
  creata_il      timestamptz not null default now()
);
alter table public.sonos_sveglie enable row level security;
revoke all on public.sonos_sveglie from anon, authenticated;

insert into public.sonos_sveglie (nome, cassa, giorni, ora, saluto, per, notizie, preferito, salta_vacanze) values
  ('Bimbi lun-mer', 'Bambini', '{1,2,3}', '07:00', 'Buongiorno Leo e Jolie, dormito bene?', 'bambini', false, 'Alternative', true),
  ('Bimbi gio-ven', 'Bambini', '{4,5}', '07:10', 'Buongiorno Leo, Jolie, Davide e Celeste, dormito bene?', 'bambini', false, 'Alternative', true),
  ('Giovanni lun-mer', 'Camera Mia', '{1,2,3}', '06:50', 'Buongiorno Giovanni!', 'giovanni', true, 'Worakls', false),
  ('Giovanni gio-ven', 'Camera Mia', '{4,5}', '07:00', 'Buongiorno Amore!', 'giovanni', true, 'Blink-182', false);

-- Sveglie da far partire adesso (un minuto prima dell'ora, per preparare il testo). Usata dal giro qui sotto.
create or replace function public.sonos_sveglie_da_fare() returns setof int
language sql stable security definer set search_path = public as $$
  select id from public.sonos_sveglie
  where attiva
    and extract(isodow from now() at time zone 'Europe/Zurich')::int = any(giorni)
    and (now() at time zone 'Europe/Zurich')::time between ora - interval '1 minute' and ora + interval '10 minutes'
    and (ultima_il is null or ultima_il < (now() at time zone 'Europe/Zurich')::date)
$$;
revoke all on function public.sonos_sveglie_da_fare() from public, anon, authenticated;

-- Ogni minuto: chiama la funzione solo se c'è una sveglia da fare.
select cron.schedule('sonos-sveglie', '* * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/sonos',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{"azione":"sveglie"}'::jsonb)
  where exists (select 1 from public.sonos_sveglie_da_fare())
$$);
