-- Second Brain GF – il backup su Drive non porta con sé la chiave di WhatsApp (12.10.2026 notte).
-- Tutto il resto come prima: tutte le tabelle di public.
create or replace function public.backup_export() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  righe jsonb;
  risultato jsonb := '{}'::jsonb;
begin
  for r in select tablename from pg_catalog.pg_tables where schemaname = 'public' order by 1 loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) - ''token''), ''[]''::jsonb) from public.%I t', r.tablename) into righe;
    risultato := risultato || jsonb_build_object(r.tablename, righe);
  end loop;
  return risultato;
end;
$$;
