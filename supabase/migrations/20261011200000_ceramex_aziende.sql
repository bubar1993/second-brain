-- Second Brain GF – Fase 2: note clienti Ceramex
-- Schede aziende (con i contatti dentro), note con mandante e sezione,
-- regole e mail viste dell'agente note. Gli id restano quelli del gestionale Ceramex,
-- così la copia si può rifare senza doppioni.

-- ---------------------------------------------------------------
-- Aziende. Una scheda per azienda; i contatti stanno dentro la scheda
-- (non nel diagramma Persone). gruppo_id = scheda madre (es. Bringhen),
-- unito_in = scheda doppia unita in un'altra.
-- ---------------------------------------------------------------
create table public.aziende (
  id              uuid primary key default gen_random_uuid(),
  utente_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area            text not null default 'C' references public.aree(codice),
  nome            text not null,
  ragione_sociale text,
  email           text[] not null default '{}',
  domini          text[] not null default '{}',
  contatti        jsonb not null default '[]',
  gruppo_id       uuid references public.aziende(id) on delete set null,
  unito_in        uuid references public.aziende(id) on delete set null,
  creata_il       timestamptz not null default now(),
  modificata_il   timestamptz not null default now(),
  eliminata_il    timestamptz
);

create index aziende_nome_idx on public.aziende (utente_id, area, nome)
  where eliminata_il is null;
create index aziende_domini_idx on public.aziende using gin (domini);
create index aziende_gruppo_idx on public.aziende (gruppo_id);

create trigger aziende_modificata before update on public.aziende
  for each row execute function public.imposta_modificata_il();

-- ---------------------------------------------------------------
-- Note: campi per le note clienti (scheda, mandante, sezione, stato)
-- e per l'agente (mail di origine, versione dell'agente, apprendimento).
-- mandante è testo libero: in Ceramex sono i mandanti, in G&C saranno i fornitori.
-- ---------------------------------------------------------------
alter table public.note drop constraint note_fonte_check;
alter table public.note add constraint note_fonte_check
  check (fonte in ('scritta','voce','foto','condivisa','mail'));

alter table public.note
  add column azienda_id     uuid references public.aziende(id) on delete set null,
  add column mandante       text,
  add column sezione        text check (sezione in
                              ('problemi','campionature','offerte','ordini','accordi','comunicazioni')),
  add column data           date,
  add column contatto       text,
  add column risolto_il     timestamptz,
  add column scartata_il    timestamptz,
  add column thread_id      text,
  add column message_id     text,
  add column testo_agente   text,
  add column sezione_agente text,
  add column imparata       boolean not null default false;

create index note_azienda_idx on public.note (azienda_id, mandante, sezione, data desc)
  where eliminata_il is null;
create index note_thread_idx on public.note (thread_id) where thread_id is not null;

-- ---------------------------------------------------------------
-- Regole degli agenti (separate per area e per agente).
-- tipo: annota | non_annotare | come_scrivere. esempi = quante correzioni la confermano.
-- ---------------------------------------------------------------
create table public.regole_agenti (
  id             uuid primary key default gen_random_uuid(),
  utente_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area           text not null references public.aree(codice),
  agente         text not null default 'note',
  tipo           text not null check (tipo in ('annota','non_annotare','come_scrivere')),
  regola         text not null,
  esempi         integer not null default 1,
  creata_il      timestamptz not null default now(),
  modificata_il  timestamptz not null default now()
);

create trigger regole_agenti_modificata before update on public.regole_agenti
  for each row execute function public.imposta_modificata_il();

-- Mail già lette dall'agente note (per non leggerle due volte).
create table public.mail_viste (
  message_id  text primary key,
  utente_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area        text not null references public.aree(codice),
  thread_id   text,
  esito       text not null check (esito in ('nota','niente')),
  motivo      text,
  vista_il    timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Sicurezza: come in fase 1.
-- ---------------------------------------------------------------
alter table public.aziende        enable row level security;
alter table public.regole_agenti  enable row level security;
alter table public.mail_viste     enable row level security;

revoke all on public.aziende, public.regole_agenti, public.mail_viste from anon;
grant select, insert, update, delete on public.aziende, public.regole_agenti, public.mail_viste
  to authenticated;

create policy "solo proprietario" on public.aziende
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.regole_agenti
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.mail_viste
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));

-- Il cestino notturno pulisce anche le aziende.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'svuota-cestino-30-giorni'),
  command := $$
    delete from public.note       where eliminata_il < now() - interval '30 days';
    delete from public.persone    where eliminata_il < now() - interval '30 days';
    delete from public.promemoria where eliminata_il < now() - interval '30 days';
    delete from public.aziende    where eliminata_il < now() - interval '30 days';
  $$
);
