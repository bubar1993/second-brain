-- Second Brain GF – Fase 5: G&C (note, posta info@homeconcepts.ch, bozze nell'app)
-- Ok di Giovanni, 11.10.2026 sera.
-- Clienti, cantieri e fornitori principali si copiano dal gestionale G&C (sola lettura, stessi id).
-- La posta di info@ la legge la funzione posta-gc (IMAP Hostpoint, senza segnare come letto).
-- L'agente G&C (routine Claude in cloud) lavora con l'utente "agente_gc": vede e scrive solo l'area G.

-- Utente predefinito: chi inserisce senza accesso (agente, funzioni) scrive per Giovanni.
create or replace function public.utente_predefinito() returns uuid
language sql stable as $$ select coalesce(auth.uid(), 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'::uuid) $$;

-- ---------------------------------------------------------------
-- Fornitori principali G&C (al posto dei mandanti). nome_breve = come appare nelle note.
-- ---------------------------------------------------------------
create table public.fornitori (
  id              uuid primary key default gen_random_uuid(),
  utente_id       uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area            text not null default 'G' references public.aree(codice),
  nome            text not null,
  nome_breve      text,
  ragione_sociale text,
  email           text,
  domini          text[] not null default '{}',
  settore         text,
  creata_il       timestamptz not null default now(),
  modificata_il   timestamptz not null default now(),
  eliminata_il    timestamptz
);
create trigger fornitori_modificata before update on public.fornitori
  for each row execute function public.imposta_modificata_il();

-- ---------------------------------------------------------------
-- Cantieri G&C (nel gestionale: sites, di solito il numero d'offerta O0…).
-- ---------------------------------------------------------------
create table public.cantieri (
  id              uuid primary key default gen_random_uuid(),
  utente_id       uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area            text not null default 'G' references public.aree(codice),
  azienda_id      uuid references public.aziende(id) on delete set null,
  nome            text not null,
  stato           text,
  descrizione     text,
  creata_il       timestamptz not null default now(),
  modificata_il   timestamptz not null default now(),
  eliminata_il    timestamptz
);
create index cantieri_azienda_idx on public.cantieri (azienda_id) where eliminata_il is null;
create trigger cantieri_modificata before update on public.cantieri
  for each row execute function public.imposta_modificata_il();

alter table public.note add column cantiere_id uuid references public.cantieri(id) on delete set null;
create index note_cantiere_idx on public.note (cantiere_id) where cantiere_id is not null;

-- ---------------------------------------------------------------
-- Posta di info@homeconcepts.ch (arrivata e inviata).
-- thread_key = primo Message-ID della conversazione (References), per legare risposte e bozze.
-- fonte: imap (letta dalla casella) | gestionale (mail salvate nel gestionale G&C, con cliente/cantiere).
-- ---------------------------------------------------------------
create table public.posta (
  id              uuid primary key default gen_random_uuid(),
  utente_id       uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area            text not null default 'G' references public.aree(codice),
  message_id      text not null unique,
  thread_key      text,
  in_reply_to     text,
  riferimenti     text[] not null default '{}',
  cartella        text not null check (cartella in ('arrivata','inviata')),
  da              text,
  da_nome         text,
  a               text[] not null default '{}',
  cc              text[] not null default '{}',
  oggetto         text,
  data            timestamptz,
  testo           text,
  allegati        jsonb not null default '[]',
  azienda_id      uuid references public.aziende(id) on delete set null,
  cantiere_id     uuid references public.cantieri(id) on delete set null,
  fornitore_id    uuid references public.fornitori(id) on delete set null,
  nota_gestionale text,
  fonte           text not null default 'imap' check (fonte in ('imap','gestionale')),
  imap_uid        bigint,
  -- lavoro dell'agente
  vista_il        timestamptz,
  esito           text check (esito in ('nota','bozza','niente','da_imparare')),
  motivo          text,
  creata_il       timestamptz not null default now()
);
create index posta_thread_idx on public.posta (thread_key);
create index posta_data_idx on public.posta (data desc);
create index posta_da_vedere_idx on public.posta (data) where vista_il is null;
create index posta_azienda_idx on public.posta (azienda_id, data desc);
create index posta_testo_idx on public.posta using gin (to_tsvector('simple', coalesce(oggetto,'') || ' ' || coalesce(testo,'')));

-- ---------------------------------------------------------------
-- Bozze di risposta: Giovanni le vede nell'app e le approva (parte da info@) o le scarta.
-- Se qualcuno risponde prima nella stessa conversazione, la bozza si annulla da sola.
-- ---------------------------------------------------------------
create table public.bozze (
  id              uuid primary key default gen_random_uuid(),
  utente_id       uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area            text not null default 'G' references public.aree(codice),
  posta_id        uuid references public.posta(id) on delete set null,
  thread_key      text,
  azienda_id      uuid references public.aziende(id) on delete set null,
  a               text[] not null default '{}',
  cc              text[] not null default '{}',
  oggetto         text,
  testo           text,
  testo_agente    text,
  stato           text not null default 'proposta'
                  check (stato in ('proposta','inviata','scartata','annullata','da_imparare','in_invio')),
  perche          jsonb not null default '{}',
  creata_il       timestamptz not null default now(),
  modificata_il   timestamptz not null default now(),
  inviata_il      timestamptz,
  inviata_message_id text,
  annullata_il    timestamptz,
  motivo_annullata text,
  errore          text,
  imparata        boolean not null default false
);
create index bozze_stato_idx on public.bozze (stato, creata_il desc);
create index bozze_thread_idx on public.bozze (thread_key);
create trigger bozze_modificata before update on public.bozze
  for each row execute function public.imposta_modificata_il();

-- Scheda di stile per contatto (come scrive Giovanni a ognuno).
create table public.contatti_stile (
  email           text primary key,
  utente_id       uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area            text not null default 'G' references public.aree(codice),
  nome            text,
  lingua          text,
  forma           text,
  aperture        text[] not null default '{}',
  chiusure        text[] not null default '{}',
  frasi_tipiche   text[] not null default '{}',
  emoji           boolean,
  note            text,
  n_invii         integer not null default 0,
  modificata_il   timestamptz not null default now()
);
create trigger contatti_stile_modificata before update on public.contatti_stile
  for each row execute function public.imposta_modificata_il();

-- Registro dei lavori automatici G&C (copia gestionale, posta).
create table public.lavori_registro (
  id           bigint generated always as identity primary key,
  lavoro       text not null,
  iniziata_il  timestamptz not null default now(),
  ok           boolean not null,
  dettagli     jsonb,
  errore       text
);
create index lavori_registro_idx on public.lavori_registro (lavoro, id desc);

-- Regole: anche per l'agente bozze.
alter table public.regole_agenti drop constraint regole_agenti_tipo_check;
alter table public.regole_agenti add constraint regole_agenti_tipo_check
  check (tipo in ('annota','non_annotare','come_scrivere','come_rispondere','non_rispondere'));

-- Gli inserimenti dell'agente valgono per Giovanni.
alter table public.note          alter column utente_id set default public.utente_predefinito();
alter table public.aziende       alter column utente_id set default public.utente_predefinito();
alter table public.regole_agenti alter column utente_id set default public.utente_predefinito();
alter table public.mail_viste    alter column utente_id set default public.utente_predefinito();

-- ---------------------------------------------------------------
-- Sicurezza per l'app (come sempre: solo Giovanni).
-- ---------------------------------------------------------------
alter table public.fornitori       enable row level security;
alter table public.cantieri        enable row level security;
alter table public.posta           enable row level security;
alter table public.bozze           enable row level security;
alter table public.contatti_stile  enable row level security;
alter table public.lavori_registro enable row level security;

revoke all on public.fornitori, public.cantieri, public.posta, public.bozze, public.contatti_stile, public.lavori_registro from anon;
grant select, insert, update, delete on public.fornitori, public.cantieri, public.posta, public.bozze, public.contatti_stile
  to authenticated;
grant select on public.lavori_registro to authenticated;

create policy "solo proprietario" on public.fornitori for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.cantieri for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.posta for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.bozze for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.contatti_stile for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "legge" on public.lavori_registro for select to authenticated using (true);

-- ---------------------------------------------------------------
-- Agente G&C: utente "agente_gc" (la password la imposta scripts/collega-agente.mjs).
-- Vede e scrive SOLO l'area G. Niente Privato, niente Ceramex, niente cancellazioni.
-- ---------------------------------------------------------------
create role agente_gc nologin noinherit;
grant usage on schema public to agente_gc;
grant select on public.aziende, public.note, public.cantieri, public.fornitori, public.posta, public.bozze,
  public.contatti_stile, public.regole_agenti, public.mail_viste, public.aree to agente_gc;
grant insert, update on public.note, public.bozze, public.contatti_stile, public.regole_agenti, public.mail_viste
  to agente_gc;
grant insert on public.aziende to agente_gc;
grant update (contatti, email, domini, ragione_sociale) on public.aziende to agente_gc;
grant update (vista_il, esito, motivo, azienda_id, cantiere_id, fornitore_id) on public.posta to agente_gc;
grant execute on function public.utente_predefinito() to agente_gc;

create policy "agente G" on public.aziende for all to agente_gc using (area = 'G') with check (area = 'G');
create policy "agente G" on public.note for all to agente_gc using (area = 'G') with check (area = 'G');
create policy "agente G" on public.cantieri for select to agente_gc using (area = 'G');
create policy "agente G" on public.fornitori for select to agente_gc using (area = 'G');
create policy "agente G" on public.posta for all to agente_gc using (area = 'G') with check (area = 'G');
create policy "agente G" on public.bozze for all to agente_gc using (area = 'G') with check (area = 'G');
create policy "agente G" on public.contatti_stile for all to agente_gc using (area = 'G') with check (area = 'G');
create policy "agente G" on public.regole_agenti for all to agente_gc using (area = 'G') with check (area = 'G');
create policy "agente G" on public.mail_viste for all to agente_gc using (area = 'G') with check (area = 'G');

-- Il registro si tiene 30 giorni.
select cron.schedule('lavori-registro-pulizia', '20 3 * * *',
  $$ delete from public.lavori_registro where iniziata_il < now() - interval '30 days' $$);
