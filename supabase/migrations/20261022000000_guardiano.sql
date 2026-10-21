-- Guardiano (21.10.2026, ok di Giovanni): ogni 15 minuti la funzione "guardiano" controlla le tre app, i due
-- gestionali, i giri degli agenti e dei lavori automatici, il backup e le richieste ferme. Ogni problema è una
-- riga in "guasti" (aperta finché il problema c'è, poi chiuso_il). La funzione "notifiche" avvisa Giovanni una
-- volta all'apertura ("Guasto: …") e una alla chiusura ("Risolto: …"); in Oggi si vedono i guasti aperti.
create table public.guasti (
  id          uuid primary key default gen_random_uuid(),
  chiave      text not null,               -- cosa è guasto: 'app:ceramex', 'db:gc', 'giro:agente-gc', 'backup', …
  titolo      text not null,               -- frase corta per Giovanni
  dettaglio   text,                        -- cosa ha visto il guardiano (errore, ultimo giro…)
  aperto_il   timestamptz not null default now(),
  visto_il    timestamptz not null default now(),  -- ultima volta che il guardiano l'ha trovato ancora
  chiuso_il   timestamptz
);
create unique index guasti_uno_aperto on public.guasti (chiave) where chiuso_il is null;
create index guasti_chiuso on public.guasti (chiuso_il);

alter table public.guasti enable row level security;
revoke all on public.guasti from anon, authenticated;
grant select on public.guasti to authenticated;
create policy "lettura per l'app" on public.guasti
  for select to authenticated using ((select auth.uid()) is not null);
-- Il Capo li può leggere (serve per il passo 3, il "Medico"); scrivere solo il guardiano.
grant select on public.guasti to agente_capo;
create policy "capo" on public.guasti for select to agente_capo using (true);

-- Quello che il guardiano legge dal database in un colpo solo (solo service_role).
create or replace function public.guardiano_dati() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'adesso', now(),
    'giri', (select coalesce(jsonb_object_agg(lavoro, g), '{}'::jsonb) from (
      select distinct on (lavoro) lavoro,
             jsonb_build_object('il', iniziata_il, 'ok', ok, 'errore', coalesce(errore, dettagli->>'riepilogo')) g
        from lavori_registro where iniziata_il > now() - interval '10 days'
       order by lavoro, id desc) x),
    'copia_ceramex', (select jsonb_build_object('il', iniziata_il, 'ok', ok, 'errore', errore)
                        from copia_registro order by id desc limit 1),
    'backup', (select jsonb_build_object('il', eseguito_il, 'ok', ok, 'errore', errore)
                 from backup_registro order by id desc limit 1),
    'richieste', (select coalesce(jsonb_agg(jsonb_build_object('agente', agente, 'stato', stato,
                          'il', coalesce(avviata_il, creata_il))), '[]'::jsonb)
                    from richieste_agenti where stato in ('nuova', 'avviata', 'in_corso')),
    'cron_ko', (select coalesce(jsonb_agg(jsonb_build_object('nome', j.jobname, 'il', d.start_time,
                        'errore', left(d.return_message, 200)) order by d.start_time desc), '[]'::jsonb)
                  from cron.job_run_details d join cron.job j using (jobid)
                 where d.status = 'failed' and d.start_time > now() - interval '30 minutes')
  )
$$;
revoke all on function public.guardiano_dati() from public, anon, authenticated;
grant execute on function public.guardiano_dati() to service_role;

-- Pulizia: i guasti chiusi da più di 60 giorni.
select cron.schedule('guasti-pulizia', '45 3 * * *',
  $$ delete from public.guasti where chiuso_il < now() - interval '60 days' $$);
-- Il giro ogni 15 minuti è nella migrazione guardiano_cron (acceso dopo la prova).
