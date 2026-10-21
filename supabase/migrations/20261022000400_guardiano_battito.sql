-- Guardiano, passo 2 (21.10.2026, ok di Giovanni): il guardiano esterno su Cloudflare chiede ogni 5 minuti il
-- "battito" del Brain (funzione guardiano con ESTERNO_TOKEN). Se il Brain non risponde, o il guardiano o le
-- notifiche non girano più, avvisa Giovanni su WhatsApp senza passare dal Brain.
create table public.guardiano_stato (
  id               int primary key default 1 check (id = 1),
  ultimo_controllo timestamptz not null default now()
);
insert into public.guardiano_stato default values;
alter table public.guardiano_stato enable row level security;
revoke all on public.guardiano_stato from anon, authenticated;

create or replace function public.guardiano_battito() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'adesso', now(),
    'guardiano', (select ultimo_controllo from guardiano_stato where id = 1),
    'notifiche', (select max(d.start_time) from cron.job_run_details d join cron.job j using (jobid)
                   where j.jobname = 'notifiche' and d.status = 'succeeded' and d.start_time > now() - interval '1 day'),
    'guasti_aperti', (select count(*) from guasti where chiuso_il is null)
  )
$$;
revoke all on function public.guardiano_battito() from public, anon, authenticated;
grant execute on function public.guardiano_battito() to service_role;
