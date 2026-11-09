-- Pagina fissa del cliente (10.11.2026, ok di Giovanni; piano controllato dall'antagonista): sconti, condizioni,
-- abitudini, sempre in cima alla scheda, separata dalle note datate.
-- La scrive SOLO Giovanni dall'app (authenticated; i connettori sono già fermati dalle regole "solo lettura").
-- agente_ceramex e agente_capo possono cambiare tutta la scheda e leggono mail di estranei: il trigger li ferma,
-- così una mail non può riscrivere gli sconti. La data la mette il database. Testo vuoto = pagina vuota (null).
-- Per tornare indietro: drop trigger, drop function, alter table … drop column.
alter table public.aziende
  add column if not exists pagina_fissa text,
  add column if not exists pagina_fissa_il timestamptz;

create or replace function public.aziende_pagina_fissa() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and (new.pagina_fissa is not null or new.pagina_fissa_il is not null))
     or (tg_op = 'UPDATE' and (new.pagina_fissa is distinct from old.pagina_fissa
                               or new.pagina_fissa_il is distinct from old.pagina_fissa_il)) then
    if current_user not in ('authenticated', 'postgres', 'supabase_admin') then
      raise exception 'La pagina fissa la scrive solo Giovanni';
    end if;
    new.pagina_fissa := nullif(btrim(new.pagina_fissa), '');
    new.pagina_fissa_il := case when new.pagina_fissa is null then null else now() end;
  end if;
  return new;
end $$;
revoke all on function public.aziende_pagina_fissa() from public, anon, authenticated;

drop trigger if exists aziende_pagina_fissa on public.aziende;
create trigger aziende_pagina_fissa before insert or update on public.aziende
  for each row execute function public.aziende_pagina_fissa();
