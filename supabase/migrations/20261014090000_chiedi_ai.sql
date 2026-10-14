-- Risposta scritta dall'AI in Chiedi (14.10.2026, ok di Giovanni: si usano i 100 $ al mese di crediti API del piano Max).
-- La funzione chiedi-ai scrive qui la risposta (stato in_corso → fatta | errore); l'app la rilegge finché è pronta,
-- così se Giovanni esce dall'app la ritrova. Solo la funzione (service role) scrive; Giovanni legge le sue.
create table public.ai_risposte (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null,
  domanda text not null,
  area text check (area in ('C', 'G', 'P')),
  stato text not null default 'in_corso' check (stato in ('in_corso', 'fatta', 'errore')),
  testo text,
  fonti jsonb not null default '[]',
  modello text,
  nota text,
  costo numeric(10, 5) not null default 0,
  prova boolean not null default false,
  creata_il timestamptz not null default now(),
  finita_il timestamptz
);
create index ai_risposte_idx on public.ai_risposte (creata_il desc);

-- Quanto si spende: una riga per ogni chiamata all'API (costo stimato dai token che l'API restituisce).
create table public.ai_uso (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  risposta_id uuid references public.ai_risposte on delete set null,
  modello text not null,
  token_in integer not null default 0,
  token_out integer not null default 0,
  cache_scrittura integer not null default 0,
  cache_lettura integer not null default 0,
  costo numeric(10, 5) not null default 0
);
create index ai_uso_quando_idx on public.ai_uso (quando desc);

-- Tetti (in dollari). inizio_ciclo = giorno del mese in cui arrivano i crediti (da correggere se serve).
-- Oltre "tetto_veloce" nel ciclo si passa al modello veloce (Haiku), oltre "tetto_stop" niente più risposte;
-- "tetto_giorno" solo contro gli errori (un giro impazzito), un giorno normale costa pochi dollari.
create table public.ai_impostazioni (
  id integer primary key default 1 check (id = 1),
  inizio_ciclo integer not null default 1 check (inizio_ciclo between 1 and 28),
  tetto_veloce numeric not null default 70,
  tetto_stop numeric not null default 90,
  tetto_giorno numeric not null default 15
);
insert into public.ai_impostazioni default values;

alter table public.ai_risposte enable row level security;
alter table public.ai_uso enable row level security;
alter table public.ai_impostazioni enable row level security;
create policy "solo proprietario" on public.ai_risposte for select to authenticated using (utente_id = (select auth.uid()));
create policy "Giovanni legge" on public.ai_uso for select to authenticated using ((select auth.uid()) = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54');
create policy "Giovanni legge" on public.ai_impostazioni for select to authenticated using ((select auth.uid()) = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54');
grant select on public.ai_risposte, public.ai_uso, public.ai_impostazioni to authenticated;

-- Connettori (app Claude): solo lettura, come per le altre tabelle (migrazione mcp_solo_lettura).
do $$
declare t text;
begin
  foreach t in array array['ai_risposte', 'ai_uso', 'ai_impostazioni'] loop
    execute format('create policy "connettori solo lettura (ins)" on public.%I as restrictive for insert to authenticated with check ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (mod)" on public.%I as restrictive for update to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (canc)" on public.%I as restrictive for delete to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
    -- Il capo vede tutto (qui solo lettura: le risposte le scrive la funzione).
    execute format('grant select on public.%I to agente_capo', t);
    execute format('drop policy if exists "capo" on public.%I', t);
    execute format('create policy "capo" on public.%I for select to agente_capo using (true)', t);
  end loop;
end $$;
