-- "Da seguire", "Circolari" e controllo dei doppioni (13.10.2026, ok di Giovanni), per Ceramex (C) e G&C (G).
-- - promesse: cose promesse da Giovanni ('io') o a lui ('altri'), trovate dall'agente nelle note; spunta nell'app.
-- - campioni: campionature con stato da_spedire → in_viaggio → arrivato (le cambiano l'agente e Giovanni).
-- - problemi fermi: niente tabella, li calcola l'app dalle note 'problemi' aperte; note.rivisto_il = "ci sto lavorando".
-- - circolari: mail dei mandanti (C) e dei fornitori (G) che non riguardano un cliente: listini, aumenti, novità.
-- - doppie: schede ditta doppie e note doppie dentro una scheda; l'agente chiede in "Domande per te" e unisce col sì.
-- Agente: routine "Agente da seguire", utente DB agente_seguire (solo C e G, niente cancellazioni).

create table public.promesse (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area text not null check (area in ('C', 'G')),
  chi text not null check (chi in ('io', 'altri')),     -- io = l'ha promesso Giovanni; altri = l'hanno promesso a lui
  testo text not null check (length(trim(testo)) > 0),
  azienda_id uuid references public.aziende(id) on delete set null,
  persona_id uuid references public.persone(id) on delete set null,
  nota_id uuid references public.note(id) on delete set null,
  mandante text,
  entro date,                                             -- entro quando (se detto)
  fatta_il timestamptz,
  chiusa_da text check (chiusa_da in ('giovanni', 'agente')),
  chiusa_nota text,                                       -- perché l'agente l'ha chiusa (es. "campioni spediti il 14.10")
  scartata_il timestamptz,                                -- Giovanni: "non serve"
  creata_il timestamptz not null default now(),
  modificata_il timestamptz not null default now()
);
create index promesse_aperte_idx on public.promesse (area, entro) where fatta_il is null and scartata_il is null;

create table public.campioni (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area text not null check (area in ('C', 'G')),
  cosa text not null check (length(trim(cosa)) > 0),      -- articoli, come nella nota
  azienda_id uuid references public.aziende(id) on delete set null,
  persona_id uuid references public.persone(id) on delete set null,
  nota_id uuid references public.note(id) on delete set null,
  mandante text,
  stato text not null default 'da_spedire' check (stato in ('da_spedire', 'in_viaggio', 'arrivato', 'annullato')),
  richiesto_il date,
  spedito_il date,
  arrivato_il date,
  cambiato_da text check (cambiato_da in ('giovanni', 'agente')),
  nota_stato text,                                        -- da dove l'agente ha capito lo stato
  creata_il timestamptz not null default now(),
  modificata_il timestamptz not null default now()
);
create index campioni_aperti_idx on public.campioni (area, stato) where stato in ('da_spedire', 'in_viaggio');

create table public.circolari (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area text not null check (area in ('C', 'G')),
  mandante text not null,                                 -- C: Marazzi|Flaviker|Profilitec|Garbelotto|Altro; G: nome_breve del fornitore
  data timestamptz not null,
  oggetto text,
  riassunto text not null,                                -- 2-3 righe
  importante boolean not null default false,              -- aumenti, cambi di condizioni, scadenze
  scadenza date,                                          -- data da ricordare (es. aumento dal 1.1)
  scadenza_testo text,                                    -- testo del promemoria proposto
  message_id text not null unique,                        -- C: id Gmail del messaggio; G: posta.message_id
  gmail_thread_id text,
  posta_id uuid references public.posta(id) on delete set null,
  letta_il timestamptz,
  promemoria_id uuid references public.promemoria(id) on delete set null,
  creata_il timestamptz not null default now()
);
create index circolari_data_idx on public.circolari (area, data desc);

-- Note già guardate dall'agente (tabella a parte: aggiornare la nota cambierebbe modificata_il e farebbe rifare
-- i riassunti delle persone all'agente lavoro).
create table public.note_seguite (
  nota_id uuid primary key references public.note(id) on delete cascade,
  vista_il timestamptz not null default now()
);

-- Doppioni già proposti (per non richiedere la stessa cosa) e aziende già controllate per le note doppie.
-- chiave: 'schede:<id1>:<id2>' (id in ordine), 'note:<id1>:<id2>:…', 'controllata:<azienda_id>'.
create table public.doppie (
  chiave text primary key,
  area text not null check (area in ('C', 'G')),
  tipo text not null check (tipo in ('schede', 'note', 'controllata')),
  dati jsonb not null default '{}',                       -- {aziende:[…], tenere:id} o {note:[…], azienda_id, testo_unito}
  domanda_id uuid references public.domande(id) on delete set null,
  esito text check (esito in ('chiesta', 'unite', 'diverse')),
  creata_il timestamptz not null default now(),
  chiusa_il timestamptz
);

-- Problemi: "ci sto lavorando" li toglie dai fermi per 7 giorni.
alter table public.note add column if not exists rivisto_il timestamptz;

-- ---------------------------------------------------------------
-- Giovanni (app): tutto sulle tabelle nuove
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['promesse', 'campioni', 'circolari', 'note_seguite', 'doppie'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
create policy "solo proprietario" on public.promesse for all to authenticated using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.campioni for all to authenticated using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.circolari for all to authenticated using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "giovanni legge" on public.note_seguite for select to authenticated using (true);
create policy "giovanni legge" on public.doppie for select to authenticated using (true);

create trigger promesse_modificata before update on public.promesse for each row execute function public.imposta_modificata_il();
create trigger campioni_modificata before update on public.campioni for each row execute function public.imposta_modificata_il();

-- ---------------------------------------------------------------
-- agente_seguire: solo C e G, niente cancellazioni
-- ---------------------------------------------------------------
create role agente_seguire nologin noinherit;
grant usage on schema public to agente_seguire;
grant execute on function public.utente_predefinito(), public.aree_persona(uuid) to agente_seguire;

grant select on public.aziende, public.note, public.persone, public.persone_aree, public.persone_aziende, public.note_persone,
  public.promemoria, public.domande, public.cantieri, public.fornitori, public.posta, public.eventi, public.ordini_marazzi,
  public.richieste_agenti, public.lavori_registro to agente_seguire;
grant select, insert, update on public.promesse, public.campioni, public.circolari, public.doppie to agente_seguire;
grant select, insert on public.note_seguite to agente_seguire;
grant insert, update on public.note, public.domande to agente_seguire;
grant insert on public.persone_aziende, public.note_persone, public.lavori_registro to agente_seguire;
grant usage on sequence public.lavori_registro_id_seq to agente_seguire;
-- Per unire due schede: la scheda doppia punta a quella tenuta, e si spostano i collegamenti.
grant update (unito_in, email, domini, contatti) on public.aziende to agente_seguire;
grant update (nota_id) on public.promemoria to agente_seguire;
grant update (azienda_id, persona_id) on public.eventi to agente_seguire;
grant update (azienda_id) on public.ordini_marazzi to agente_seguire;
grant update (stato, risposta, risposta_il, presa_il) on public.richieste_agenti to agente_seguire;

create policy "agente seguire" on public.aziende for select to agente_seguire using (area in ('C', 'G'));
create policy "agente seguire unisce" on public.aziende for update to agente_seguire using (area in ('C', 'G')) with check (area in ('C', 'G'));
create policy "agente seguire" on public.note for select to agente_seguire using (area in ('C', 'G'));
create policy "agente seguire scrive" on public.note for insert to agente_seguire with check (area in ('C', 'G') and not da_ceramex);
create policy "agente seguire unisce" on public.note for update to agente_seguire using (area in ('C', 'G')) with check (area in ('C', 'G'));
create policy "agente seguire" on public.persone for select to agente_seguire
  using (public.aree_persona(id) && array['C', 'G']);
create policy "agente seguire" on public.persone_aree for select to agente_seguire using (area in ('C', 'G'));
create policy "agente seguire" on public.persone_aziende for select to agente_seguire using (exists (select 1 from public.aziende a where a.id = azienda_id));
create policy "agente seguire aggiunge" on public.persone_aziende for insert to agente_seguire with check (exists (select 1 from public.aziende a where a.id = azienda_id));
create policy "agente seguire" on public.note_persone for select to agente_seguire using (exists (select 1 from public.note n where n.id = nota_id));
create policy "agente seguire aggiunge" on public.note_persone for insert to agente_seguire with check (exists (select 1 from public.note n where n.id = nota_id));
create policy "agente seguire" on public.promemoria for select to agente_seguire using (area in ('C', 'G'));
create policy "agente seguire sposta" on public.promemoria for update to agente_seguire using (area in ('C', 'G')) with check (area in ('C', 'G'));
create policy "agente seguire" on public.domande for all to agente_seguire using (area in ('C', 'G')) with check (area in ('C', 'G') and agente = 'seguire');
create policy "agente seguire" on public.cantieri for select to agente_seguire using (area in ('C', 'G'));
create policy "agente seguire" on public.fornitori for select to agente_seguire using (area in ('C', 'G'));
create policy "agente seguire" on public.posta for select to agente_seguire using (area = 'G');
create policy "agente seguire" on public.eventi for select to agente_seguire using (area in ('C', 'G'));
create policy "agente seguire sposta" on public.eventi for update to agente_seguire using (area in ('C', 'G')) with check (area in ('C', 'G'));
create policy "agente seguire" on public.ordini_marazzi for select to agente_seguire using (true);
create policy "agente seguire sposta" on public.ordini_marazzi for update to agente_seguire using (true) with check (true);
create policy "agente seguire" on public.promesse for all to agente_seguire using (area in ('C', 'G')) with check (area in ('C', 'G'));
create policy "agente seguire" on public.campioni for all to agente_seguire using (area in ('C', 'G')) with check (area in ('C', 'G'));
create policy "agente seguire" on public.circolari for all to agente_seguire using (area in ('C', 'G')) with check (area in ('C', 'G'));
create policy "agente seguire" on public.doppie for all to agente_seguire using (true) with check (true);
create policy "agente seguire" on public.note_seguite for all to agente_seguire using (true) with check (true);
create policy "agente seguire" on public.richieste_agenti for select to agente_seguire using (agente = 'seguire');
create policy "agente seguire risponde" on public.richieste_agenti for update to agente_seguire using (agente = 'seguire') with check (agente = 'seguire');
create policy "agente seguire" on public.lavori_registro for select to agente_seguire using (lavoro like 'agente-seguire%');
create policy "agente seguire scrive" on public.lavori_registro for insert to agente_seguire with check (lavoro like 'agente-seguire%');
revoke delete, truncate on all tables in schema public from agente_seguire;

-- Lo smistatore e Giovanni possono scrivere anche a questo agente.
alter table public.richieste_agenti drop constraint richieste_agenti_agente_check;
alter table public.richieste_agenti add constraint richieste_agenti_agente_check
  check (agente in ('lavoro', 'ceramex', 'gc', 'calendario', 'privato', 'archiviazione', 'smistatore', 'seguire'));
alter table public.richieste_agenti drop constraint richieste_agenti_seguito_agente_check;
alter table public.richieste_agenti add constraint richieste_agenti_seguito_agente_check
  check (seguito_agente in ('lavoro', 'ceramex', 'gc', 'calendario', 'archiviazione', 'seguire'));

-- Connettori (app Claude): solo lettura anche sulle tabelle nuove.
do $$
declare t text;
begin
  foreach t in array array['promesse', 'campioni', 'circolari', 'note_seguite', 'doppie'] loop
    execute format('create policy "connettori solo lettura (ins)" on public.%I as restrictive for insert to authenticated with check ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (mod)" on public.%I as restrictive for update to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (canc)" on public.%I as restrictive for delete to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
  end loop;
end $$;
