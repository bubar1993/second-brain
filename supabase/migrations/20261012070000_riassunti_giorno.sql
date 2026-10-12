-- Second Brain GF – riassunto del mattino e della sera in Oggi (fase 3), 12.10.2026 notte.
-- Lo scrivono gli agenti: quello del lavoro per Ceramex + G&C, quello privato per il Privato
-- (restano separati: nessuno dei due vede la parte dell'altro).

create table public.riassunti_giorno (
  giorno      date not null,
  parte       text not null check (parte in ('lavoro','privato')),
  momento     text not null check (momento in ('mattino','sera')),
  utente_id   uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  testo       text not null,
  creata_il   timestamptz not null default now(),
  primary key (giorno, parte, momento)
);
alter table public.riassunti_giorno enable row level security;
revoke all on public.riassunti_giorno from anon;
grant select on public.riassunti_giorno to authenticated;
create policy "solo proprietario" on public.riassunti_giorno for select to authenticated using (utente_id = (select auth.uid()));

grant select, insert, update on public.riassunti_giorno to agente_lavoro, agente_privato;
create policy "agente lavoro" on public.riassunti_giorno for all to agente_lavoro using (parte = 'lavoro') with check (parte = 'lavoro');
create policy "agente privato" on public.riassunti_giorno for all to agente_privato using (parte = 'privato') with check (parte = 'privato');

-- Gli agenti delle note vedono anche gli appuntamenti della loro area (per i riassunti e "prima della visita").
grant update (area, azienda_id, persona_id) on public.eventi to agente_lavoro;
create policy "agente lavoro collega" on public.eventi for update to agente_lavoro using (area in ('C','G') or area is null) with check (area in ('C','G'));
drop policy "agente lavoro" on public.eventi;
create policy "agente lavoro" on public.eventi for select to agente_lavoro using (area in ('C','G') or area is null);

-- Vecchi riassunti: si tengono 60 giorni.
select cron.schedule('riassunti-giorno-pulizia', '25 3 * * *',
  $$ delete from public.riassunti_giorno where giorno < current_date - 60 $$);
