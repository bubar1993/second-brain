-- Schermata "Agenti" (12.10.2026, ok di Giovanni): Giovanni scrive a un agente dall'app.
-- "Fallo adesso" fa partire subito la routine (funzione agente-subito, trigger API della routine);
-- altrimenti l'agente la legge al giro programmato. L'agente risponde nella stessa riga.
create table public.richieste_agenti (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null default utente_predefinito() references auth.users(id) on delete cascade,
  agente text not null check (agente in ('lavoro', 'ceramex', 'gc', 'calendario', 'privato')),
  testo text not null check (length(trim(testo)) > 0),
  stato text not null default 'nuova' check (stato in ('nuova', 'avviata', 'in_corso', 'fatta', 'non_fatta')),
  creata_il timestamptz not null default now(),
  avviata_il timestamptz,          -- quando "Fallo adesso" ha fatto partire la routine
  sessione_url text,               -- il giro su claude.ai
  presa_il timestamptz,            -- quando l'agente l'ha presa
  risposta text,
  risposta_il timestamptz,
  vista_il timestamptz,            -- quando Giovanni ha letto la risposta
  errore text                      -- se "Fallo adesso" non è riuscito (allora la fa il giro programmato)
);
create index richieste_agenti_idx on public.richieste_agenti (agente, stato, creata_il desc);

alter table public.richieste_agenti enable row level security;
create policy "solo proprietario" on public.richieste_agenti for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "connettori solo lettura (ins)" on public.richieste_agenti as restrictive for insert to authenticated with check ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (mod)" on public.richieste_agenti as restrictive for update to authenticated using ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (canc)" on public.richieste_agenti as restrictive for delete to authenticated using ((auth.jwt() ->> 'client_id') is null);

-- Ogni agente vede e aggiorna solo le richieste fatte a lui (niente insert, niente cancellazioni).
do $$
declare r record;
begin
  for r in select * from (values ('agente_gc', 'gc'), ('agente_lavoro', 'lavoro'), ('agente_privato', 'privato'),
                                 ('agente_calendario', 'calendario'), ('agente_ceramex', 'ceramex')) v(ruolo, agente) loop
    execute format('grant select, update (stato, presa_il, risposta, risposta_il) on public.richieste_agenti to %I', r.ruolo);
    execute format('create policy %I on public.richieste_agenti for select to %I using (agente = %L)', 'agente ' || r.agente, r.ruolo, r.agente);
    execute format('create policy %I on public.richieste_agenti for update to %I using (agente = %L) with check (agente = %L)', 'agente ' || r.agente || ' risponde', r.ruolo, r.agente, r.agente);
  end loop;
end $$;

-- L'agente G&C scrive anche lui nel registro, come gli altri (serve alla schermata Agenti).
grant insert on public.lavori_registro to agente_gc;
grant usage on sequence public.lavori_registro_id_seq to agente_gc;
create policy "agente gc" on public.lavori_registro for insert to agente_gc with check (lavoro like 'agente-gc%');
