-- Messaggi Sonos a un'ora precisa (27.10.2026, ok di Giovanni): un giorno, un'ora, una o più stanze e un testo scritto
-- da lui, detto da Laomedeia una volta sola. La voce si prepara quando salva (stessa voce per tutte le stanze).
-- Li fa la funzione `sonos` (azione 'sveglie', il giro di ogni minuto). Come le sveglie: solo il server li vede
-- (niente app, agenti, Capo). data e ora sono di Zurigo.
-- ATTENZIONE: tabella da escludere dal blocco "capo vede tutto" (migrazione capo) se lo rilanci, come
-- sonos_collegamento, sonos_sveglie e sonos_giorni: il Capo legge mail di estranei e qui farebbe parlare le casse
-- senza i due tocchi di Giovanni.
create table public.sonos_messaggi (
  id         serial primary key,
  data       date not null,
  ora        time not null,
  casse      text[] not null check (cardinality(casse) between 1 and 6),
  testo      text not null check (char_length(testo) between 1 and 300),
  volume     smallint not null default 20 check (volume between 5 and 60),
  detto_il   timestamptz,          -- preso dal giro (una volta sola)
  dette      text[],               -- stanze dove ha suonato davvero
  errore     text,
  creato_il  timestamptz not null default now()
);
-- Niente doppioni (doppio tocco, o salvato di nuovo dopo un errore di rete): stesso giorno, ora e testo ancora da dire.
create unique index sonos_messaggi_unico on public.sonos_messaggi (data, ora, md5(testo)) where detto_il is null;
alter table public.sonos_messaggi enable row level security;
revoke all on public.sonos_messaggi from anon, authenticated;
grant all on public.sonos_messaggi to service_role;
grant usage, select on sequence public.sonos_messaggi_id_seq to service_role;

-- Messaggi da dire adesso: arrivati all'ora e non più vecchi di 15 minuti (se Sonos o la funzione erano giù, dopo
-- non si dicono più: restano "non detto" nella pagina).
create or replace function public.sonos_messaggi_da_fare() returns setof int
language sql stable security definer set search_path = public as $$
  select id from public.sonos_messaggi
  where detto_il is null
    and (data + ora) at time zone 'Europe/Zurich' <= now()
    and (data + ora) at time zone 'Europe/Zurich' > now() - interval '15 minutes'
$$;
revoke all on function public.sonos_messaggi_da_fare() from public, anon, authenticated;
grant execute on function public.sonos_messaggi_da_fare() to service_role;

-- Ogni minuto: chiama la funzione se c'è una sveglia da fare, una musica da fermare o un messaggio da dire.
select cron.schedule('sonos-sveglie', '* * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/sonos',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{"azione":"sveglie"}'::jsonb)
  where exists (select 1 from public.sonos_sveglie_da_fare())
     or exists (select 1 from public.sonos_sveglie where spegni_alle <= now())
     or exists (select 1 from public.sonos_messaggi_da_fare())
$$);
