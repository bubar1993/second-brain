-- Guardiano, due controlli in più (22.10.2026, ok di Giovanni). Dal 20 al 22.10 la rubrica non si è sincronizzata
-- (Google rispondeva 400) e il guardiano non l'ha visto: il lavoro pg_cron partiva bene, era la funzione a dare errore.
-- 'http_ko': le risposte con errore (codice 400 o più) alle chiamate di pg_net (cioè le funzioni chiamate dai
--            lavori automatici) negli ultimi 30 minuti. pg_net non tiene l'indirizzo: resta il testo dell'errore.
-- 'rubrica': l'ultima sincronizzazione riuscita della rubrica.
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
                 where d.status = 'failed' and d.start_time > now() - interval '30 minutes'),
    'http_ko', (select coalesce(jsonb_agg(jsonb_build_object('il', created, 'stato', status_code,
                        'errore', left(coalesce(nullif(content, ''), error_msg), 300)) order by created desc), '[]'::jsonb)
                  from net._http_response
                 where status_code >= 400 and created > now() - interval '30 minutes'),
    'rubrica', (select ultimo_giro from rubrica_stato order by ultimo_giro desc nulls last limit 1)
  )
$$;
revoke all on function public.guardiano_dati() from public, anon, authenticated;
grant execute on function public.guardiano_dati() to service_role;
