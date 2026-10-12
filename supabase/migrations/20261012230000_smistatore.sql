-- Smistatore (12.10.2026 notte, ok di Giovanni): un agente che non fa lavori ma passa i comandi all'agente giusto.
-- Guarda le domande degli agenti (e le risposte di Giovanni) e le richieste non riuscite, capisce chi può farlo
-- e scrive una richiesta a quell'agente (richieste_agenti, da = 'smistatore'), poi lo fa partire subito
-- (funzione agente-subito). Utente del database "agente_smistatore": NON scrive note, schede o dati;
-- legge solo domande, richieste e registro di Ceramex e G&C (mai il Privato) e scrive richieste agli agenti.
create role agente_smistatore nologin noinherit;
grant usage on schema public to agente_smistatore;
grant execute on function public.utente_predefinito() to agente_smistatore;

-- Domande: chi l'ha già smistata e a chi.
alter table public.domande add column if not exists smistata_il timestamptz;
alter table public.domande add column if not exists smistata_nota text;

-- Richieste: chi le ha scritte (Giovanni o lo smistatore) e da quale domanda/richiesta nascono.
alter table public.richieste_agenti add column if not exists da text not null default 'giovanni' check (da in ('giovanni', 'smistatore'));
alter table public.richieste_agenti add column if not exists domanda_id uuid references public.domande(id) on delete set null;
alter table public.richieste_agenti add column if not exists origine_id uuid references public.richieste_agenti(id) on delete set null;
alter table public.richieste_agenti drop constraint if exists richieste_agenti_agente_check;
alter table public.richieste_agenti add constraint richieste_agenti_agente_check
  check (agente in ('lavoro', 'ceramex', 'gc', 'calendario', 'privato', 'archiviazione', 'smistatore'));

-- Domande di lavoro: le legge; scrive solo lo smistamento e, quando passa lui il lavoro a un altro agente,
-- la risposta al posto di Giovanni (ok di Giovanni: "può fare da solo").
grant select on public.domande to agente_smistatore;
grant update (smistata_il, smistata_nota, risposta, risposta_il) on public.domande to agente_smistatore;
create policy "smistatore" on public.domande for select to agente_smistatore
  using (area in ('C', 'G') or (area is null and agente <> 'privato'));
create policy "smistatore smista" on public.domande for update to agente_smistatore
  using (area in ('C', 'G') or (area is null and agente <> 'privato'))
  with check (area in ('C', 'G') or (area is null and agente <> 'privato'));

-- Richieste: legge quelle di lavoro; scrive richieste agli agenti di lavoro; risponde alle sue.
grant select, insert on public.richieste_agenti to agente_smistatore;
grant update (stato, presa_il, risposta, risposta_il) on public.richieste_agenti to agente_smistatore;
create policy "smistatore legge" on public.richieste_agenti for select to agente_smistatore using (agente <> 'privato');
create policy "smistatore passa" on public.richieste_agenti for insert to agente_smistatore
  with check (da = 'smistatore' and agente in ('lavoro', 'ceramex', 'gc', 'calendario', 'archiviazione'));
create policy "smistatore risponde" on public.richieste_agenti for update to agente_smistatore
  using (agente = 'smistatore') with check (agente = 'smistatore');

-- Per capire chi può fare cosa: il registro degli agenti di lavoro e i nomi delle ditte.
grant select on public.lavori_registro to agente_smistatore;
create policy "smistatore legge" on public.lavori_registro for select to agente_smistatore using (lavoro not like 'agente-privato%');
grant insert on public.lavori_registro to agente_smistatore;
grant usage on sequence public.lavori_registro_id_seq to agente_smistatore;
create policy "smistatore scrive" on public.lavori_registro for insert to agente_smistatore with check (lavoro like 'agente-smistatore%');
grant select (id, area, nome, ragione_sociale, gruppo_id, unito_in, eliminata_il) on public.aziende to agente_smistatore;
create policy "smistatore" on public.aziende for select to agente_smistatore using (area in ('C', 'G'));

-- L'archiviazione G&C (utente agente_gc) riceve anche lei richieste: agente = 'archiviazione'.
create policy "agente archiviazione" on public.richieste_agenti for select to agente_gc using (agente = 'archiviazione');
create policy "agente archiviazione risponde" on public.richieste_agenti for update to agente_gc
  using (agente = 'archiviazione') with check (agente = 'archiviazione');
