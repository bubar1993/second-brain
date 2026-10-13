-- Second Brain GF – ditta scelta a mano nella scheda persona (13.10.2026, richiesta di Giovanni).
-- Giovanni aggiunge o toglie una ditta dalla scheda persona. Le ditte tolte si ricordano qui,
-- così sincronizza_persone() (ogni 15 min, dai contatti delle schede) non le rimette.
create table public.persone_aziende_tolte (
  persona_id  uuid not null references public.persone(id) on delete cascade,
  azienda_id  uuid not null references public.aziende(id) on delete cascade,
  utente_id   uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  tolta_il    timestamptz not null default now(),
  primary key (persona_id, azienda_id)
);

alter table public.persone_aziende_tolte enable row level security;
revoke all on public.persone_aziende_tolte from anon;
grant select, insert, update, delete on public.persone_aziende_tolte to authenticated;
create policy "solo proprietario" on public.persone_aziende_tolte for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "connettori solo lettura (ins)" on public.persone_aziende_tolte as restrictive for insert to authenticated with check ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (mod)" on public.persone_aziende_tolte as restrictive for update to authenticated using ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (canc)" on public.persone_aziende_tolte as restrictive for delete to authenticated using ((auth.jwt() ->> 'client_id') is null);
-- Gli agenti la leggono (per non ricollegare); il capo vede tutto.
grant select on public.persone_aziende_tolte to agente_lavoro, agente_privato;
create policy "agenti leggono" on public.persone_aziende_tolte for select to agente_lavoro, agente_privato using (true);
grant select, insert, update on public.persone_aziende_tolte to agente_capo;
create policy "capo" on public.persone_aziende_tolte for all to agente_capo using (true) with check (true);

-- sincronizza_persone(): il collegamento persona ↔ ditta non si rifà se Giovanni l'ha tolto.
do $$
declare
  d text;
  prima text := 'insert into public.persone_aziende (persona_id, azienda_id, ruolo, utente_id) values (pid, r.azienda_id, r.ruolo, u)';
  dopo text := 'insert into public.persone_aziende (persona_id, azienda_id, ruolo, utente_id) select pid, r.azienda_id, r.ruolo, u'
    || ' where not exists (select 1 from public.persone_aziende_tolte t where t.persona_id = pid and t.azienda_id = r.azienda_id)';
begin
  d := pg_get_functiondef('public.sincronizza_persone'::regproc);
  if position(prima in d) = 0 then
    raise exception 'sincronizza_persone: riga del collegamento non trovata';
  end if;
  execute replace(d, prima, dopo);
end $$;
