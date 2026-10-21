-- Giorni speciali delle sveglie (21.10.2026, Giovanni): un giorno può fare "come" un altro giorno della settimana.
-- Uso: settimana senza Alessia (niente Davide e Celeste) → giovedì e venerdì come lunedì (sveglie lun–mer).
create table public.sonos_giorni (
  data  date primary key,
  come  smallint not null check (come between 1 and 7),
  nota  text
);
alter table public.sonos_giorni enable row level security;
revoke all on public.sonos_giorni from anon, authenticated;

create or replace function public.sonos_sveglie_da_fare() returns setof int
language sql stable security definer set search_path = public as $$
  with oggi as (
    select (now() at time zone 'Europe/Zurich')::date as data,
           coalesce((select come from public.sonos_giorni where data = (now() at time zone 'Europe/Zurich')::date),
                    extract(isodow from now() at time zone 'Europe/Zurich')::int) as giorno
  )
  select s.id from public.sonos_sveglie s, oggi
  where s.attiva
    and oggi.giorno = any(s.giorni)
    and (now() at time zone 'Europe/Zurich')::time between s.ora - interval '1 minute' and s.ora + interval '10 minutes'
    and (s.ultima_il is null or s.ultima_il < oggi.data)
$$;
revoke all on function public.sonos_sveglie_da_fare() from public, anon, authenticated;

-- Questa settimana Alessia non c'è: giovedì 22 e venerdì 23.10 come lunedì. Il saluto speciale non serve più.
insert into public.sonos_giorni (data, come, nota) values
  ('2026-10-22', 1, 'Senza Alessia'), ('2026-10-23', 1, 'Senza Alessia');
update public.sonos_sveglie set eccezioni = '{}'::jsonb where nome = 'Bimbi gio-ven';
