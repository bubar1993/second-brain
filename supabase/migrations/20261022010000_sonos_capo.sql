-- Sonos dal Capo (22.10.2026, ok di Giovanni): il Capo prepara un annuncio o un cambio alle sveglie in capo_conferme
-- (tipo 'sonos', i dati precisi in `dati`); lo fa la funzione `sonos` solo dopo i due tocchi di Giovanni nell'app.
do $$
declare n text;
begin
  select conname into n from pg_constraint
  where conrelid = 'public.capo_conferme'::regclass and pg_get_constraintdef(oid) like '%tipo = ANY%';
  execute format('alter table public.capo_conferme drop constraint %I', n);
end $$;
alter table public.capo_conferme add constraint capo_conferme_tipo_check
  check (tipo in ('mail', 'messaggio', 'cancella', 'gestionale', 'sposta_mail', 'calendario', 'sonos', 'altro'));
alter table public.capo_conferme add column if not exists dati jsonb;

-- Eccezioni di un giorno per una sveglia: eccezioni->'AAAA-MM-GG' = "saluto" (vecchio) oppure {saluto?, ora?, spenta?}.
create or replace function public.sonos_sveglie_da_fare() returns setof int
language sql stable security definer set search_path = public as $$
  with oggi as (
    select (now() at time zone 'Europe/Zurich')::date as data,
           (now() at time zone 'Europe/Zurich')::time as adesso,
           coalesce((select come from public.sonos_giorni where data = (now() at time zone 'Europe/Zurich')::date),
                    extract(isodow from now() at time zone 'Europe/Zurich')::int) as giorno
  ), s as (
    select sv.*, oggi.data, oggi.adesso, oggi.giorno,
           coalesce((sv.eccezioni -> (oggi.data::text) ->> 'ora')::time, sv.ora) as ora_oggi,
           coalesce((sv.eccezioni -> (oggi.data::text) ->> 'spenta')::boolean, false) as spenta_oggi
    from public.sonos_sveglie sv, oggi
  )
  select id from s
  where attiva and not spenta_oggi
    and giorno = any(giorni)
    and adesso between ora_oggi - interval '1 minute' and ora_oggi + interval '10 minutes'
    and (ultima_il is null or ultima_il < data)
$$;
revoke all on function public.sonos_sveglie_da_fare() from public, anon, authenticated;
