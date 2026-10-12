-- Connettore "Second Brain" per l'app Claude (12.10.2026, ok di Giovanni): i token dati dal server OAuth di
-- Supabase ai programmi esterni (hanno il campo client_id) possono SOLO leggere. Regole "restrictive":
-- si sommano a quelle che ci sono già e valgono solo per questi token; l'app e gli agenti non cambiano.
-- ATTENZIONE: per le tabelle nuove rilanciare questo blocco (o aggiungere le tre regole a mano).
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists "connettori solo lettura (ins)" on public.%I', t.relname);
    execute format('drop policy if exists "connettori solo lettura (mod)" on public.%I', t.relname);
    execute format('drop policy if exists "connettori solo lettura (canc)" on public.%I', t.relname);
    execute format('create policy "connettori solo lettura (ins)" on public.%I as restrictive for insert to authenticated with check ((auth.jwt() ->> ''client_id'') is null)', t.relname);
    execute format('create policy "connettori solo lettura (mod)" on public.%I as restrictive for update to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t.relname);
    execute format('create policy "connettori solo lettura (canc)" on public.%I as restrictive for delete to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t.relname);
  end loop;
end $$;
