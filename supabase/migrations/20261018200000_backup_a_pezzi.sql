-- Backup a pezzi (18.10.2026): backup_export() leggeva tutte le tabelle in una sola istruzione e il
-- 18.10 è stato interrotto dal limite di 8 secondi (posta 21 MB, vettori 28 MB). Ora la funzione
-- `backup` chiede l'elenco delle tabelle e poi ogni tabella a pezzi. Stesse regole di prima:
-- solo lo schema public, la colonna "token" non si esporta mai, solo service_role.

create or replace function public.backup_tabelle()
returns text[]
language sql
security definer
set search_path to ''
as $$
  select coalesce(array_agg(tablename::text order by tablename), '{}')
  from pg_catalog.pg_tables where schemaname = 'public'
$$;

create or replace function public.backup_export_pezzo(p_tabella text, p_da integer, p_quanti integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  righe jsonb;
begin
  if not exists (select 1 from pg_catalog.pg_tables where schemaname = 'public' and tablename = p_tabella) then
    raise exception 'Tabella sconosciuta: %', p_tabella;
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - ''token''), ''[]''::jsonb) from (select * from public.%I order by ctid offset %s limit %s) t',
    p_tabella, greatest(p_da, 0), least(greatest(p_quanti, 1), 2000)
  ) into righe;
  return righe;
end;
$$;

revoke all on function public.backup_tabelle() from public, anon, authenticated;
revoke all on function public.backup_export_pezzo(text, integer, integer) from public, anon, authenticated;
grant execute on function public.backup_tabelle() to service_role;
grant execute on function public.backup_export_pezzo(text, integer, integer) to service_role;
