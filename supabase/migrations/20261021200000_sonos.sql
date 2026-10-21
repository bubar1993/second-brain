-- Sonos nel Privato (21.10.2026, ok di Giovanni): annunci (poi sveglie) sulle casse di casa, funzione `sonos`.
-- Collegamento (uno solo). I token di Sonos li vede solo il server: nessun permesso all'app, agli agenti, al Capo.
-- ATTENZIONE: tabella esclusa dal blocco "capo vede tutto" (migrazione capo): se lo rilanci, lasciala fuori.
create table public.sonos_collegamento (
  id              smallint primary key default 1 check (id = 1),
  access_token    text,
  refresh_token   text,
  scade_il        timestamptz,
  household_id    text,
  stato_oauth     text,
  stato_oauth_il  timestamptz,
  collegato_il    timestamptz,
  errore          text
);
alter table public.sonos_collegamento enable row level security;
revoke all on public.sonos_collegamento from anon, authenticated;
insert into public.sonos_collegamento (id) values (1);

-- Stato leggibile dall'app (senza token).
create view public.sonos_stato with (security_invoker = false) as
  select refresh_token is not null as collegato, household_id, collegato_il, errore
  from public.sonos_collegamento;
revoke all on public.sonos_stato from anon;
grant select on public.sonos_stato to authenticated;
