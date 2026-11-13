-- Gruppi WhatsApp di lavoro (13.11.2026, ok di Giovanni, piano controllato dall'antagonista).
-- I gruppi non passano dal collegamento ufficiale di Meta. Di notte il programma scripts/wa-gruppi.ps1 li legge sul PC
-- da WhatsApp Desktop (accessibilita' di Windows, senza AI) e manda i messaggi alla funzione wa-gruppi, che scrive qui.
-- La mattina la routine "Agente gruppi WhatsApp" (utente agente_gruppi) li ordina e scrive le note.
-- Tabelle SEPARATE da wa_contatti/wa_messaggi: gli altri agenti e l'app non cambiano (scelta di Giovanni).
-- Mai gruppi privati: si leggono solo i gruppi di questa lista, che decide Giovanni (aree C e G soltanto).

create table public.wa_gruppi (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique,                    -- nome IDENTICO a quello in WhatsApp (emoji comprese)
  area            text not null check (area in ('C', 'G')),
  mandante        text,                                    -- mandante predefinito delle note (puo' restare vuoto)
  attivo          boolean not null default true,
  ultimo_letto_il timestamptz,
  ultimo_esito    jsonb,
  creato_il       timestamptz not null default now()
);

create table public.wa_gruppi_messaggi (
  id          bigserial primary key,
  gruppo_id   uuid not null references public.wa_gruppi(id),
  impronta    text not null check (impronta ~ '^[0-9a-f]{64}$'),   -- gruppo + minuto + tipo + testo: niente doppioni
  data        timestamptz not null,
  mittente    text not null,                                -- 'Tu' = Giovanni
  direzione   text not null check (direzione in ('in', 'out')),
  tipo        text not null check (tipo in ('testo', 'documento', 'foto', 'vocale')),
  testo       text not null check (char_length(testo) between 1 and 4000),
  citazione   text,                                         -- inizio del messaggio a cui risponde
  creata_il   timestamptz not null default now(),
  lavorato_il timestamptz,                                  -- lo mette l'agente gruppi
  unique (gruppo_id, impronta)
);
create index wa_gruppi_messaggi_data on public.wa_gruppi_messaggi (gruppo_id, data);
create index wa_gruppi_messaggi_da_lavorare on public.wa_gruppi_messaggi (data) where lavorato_il is null;

-- Le note nate da un gruppo si riconoscono (e l'agente gruppi vede solo quelle).
alter table public.note add column if not exists wa_gruppo_id uuid references public.wa_gruppi(id);

alter table public.wa_gruppi enable row level security;
alter table public.wa_gruppi_messaggi enable row level security;
revoke all on public.wa_gruppi, public.wa_gruppi_messaggi from anon, authenticated;
grant select on public.wa_gruppi, public.wa_gruppi_messaggi to authenticated;
grant all on public.wa_gruppi, public.wa_gruppi_messaggi to service_role;
grant usage, select on sequence public.wa_gruppi_messaggi_id_seq to service_role;
create policy "Giovanni legge" on public.wa_gruppi for select to authenticated using ((select auth.uid()) = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54');
create policy "Giovanni legge" on public.wa_gruppi_messaggi for select to authenticated using ((select auth.uid()) = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54');

-- Connettori (app Claude) solo lettura e Capo solo lettura: la lista dei gruppi la cambia solo Giovanni (con Claude Code),
-- mai un agente che legge mail di estranei (potrebbe far leggere un gruppo privato).
do $$
declare t text;
begin
  foreach t in array array['wa_gruppi', 'wa_gruppi_messaggi'] loop
    execute format('create policy "connettori solo lettura (ins)" on public.%I as restrictive for insert to authenticated with check ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (mod)" on public.%I as restrictive for update to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (canc)" on public.%I as restrictive for delete to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('grant select on public.%I to agente_capo', t);
    execute format('drop policy if exists "capo" on public.%I', t);
    execute format('create policy "capo" on public.%I for select to agente_capo using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- agente_gruppi: legge i messaggi dei gruppi, scrive SOLO note di gruppo (C e G) e il suo registro. Niente cancellazioni.
-- ---------------------------------------------------------------
create role agente_gruppi nologin noinherit;
grant usage on schema public to agente_gruppi;
grant execute on function public.utente_predefinito() to agente_gruppi;
grant select on public.wa_gruppi, public.wa_gruppi_messaggi, public.aziende, public.cantieri, public.fornitori,
  public.note, public.lavori_registro to agente_gruppi;
grant update (lavorato_il) on public.wa_gruppi_messaggi to agente_gruppi;
grant insert on public.note, public.lavori_registro to agente_gruppi;
grant usage on sequence public.lavori_registro_id_seq to agente_gruppi;

create policy "agente gruppi" on public.wa_gruppi for select to agente_gruppi using (true);
create policy "agente gruppi" on public.wa_gruppi_messaggi for select to agente_gruppi using (true);
create policy "agente gruppi segna" on public.wa_gruppi_messaggi for update to agente_gruppi using (true) with check (true);
create policy "agente gruppi" on public.aziende for select to agente_gruppi using (area in ('C', 'G'));
create policy "agente gruppi" on public.cantieri for select to agente_gruppi using (area in ('C', 'G'));
create policy "agente gruppi" on public.fornitori for select to agente_gruppi using (area in ('C', 'G'));
-- Note: vede e scrive solo quelle nate da un gruppo, gia' "lavorate" (cosi' l'agente lavoro non le riprende),
-- nell'area del gruppo.
create policy "agente gruppi" on public.note for select to agente_gruppi using (wa_gruppo_id is not null and area in ('C', 'G'));
create policy "agente gruppi scrive" on public.note for insert to agente_gruppi
  with check (fonte = 'whatsapp' and not da_ceramex and lavorata_il is not null and wa_gruppo_id is not null
    and area = (select g.area from public.wa_gruppi g where g.id = wa_gruppo_id));
create policy "agente gruppi" on public.lavori_registro for select to agente_gruppi using (lavoro like 'agente-gruppi%');
create policy "agente gruppi scrive" on public.lavori_registro for insert to agente_gruppi with check (lavoro like 'agente-gruppi%');
revoke delete, truncate on all tables in schema public from agente_gruppi;

-- I primi tre gruppi scelti da Giovanni il 13.11.2026 (nomi letti da WhatsApp Desktop; le emoji scritte con il loro codice).
insert into public.wa_gruppi (nome, area, mandante) values
  (U&'Marazzi CH \+01F1E8\+01F1ED Business', 'C', 'Marazzi'),
  (U&'RAGNO BUSINESS \+01F577\FE0F', 'C', 'Marazzi'),
  ('G&C BUSINESS', 'G', null)
on conflict (nome) do nothing;
