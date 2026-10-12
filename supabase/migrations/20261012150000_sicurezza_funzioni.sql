-- Chiusura di sicurezza (ok di Giovanni, 12.10.2026): le funzioni "security definer" non rispondono
-- più a chi non è entrato (anon). Restano per Giovanni, per le funzioni del server e per gli agenti.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.area_contatto_wa(text)',
    'public.aree_persona(uuid)',
    'public.utente_predefinito()',
    'public.wa_aggiorna_contatto()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role, agente_gc, agente_lavoro, agente_privato, agente_calendario', f);
  end loop;
end $$;

-- L'agente calendario sceglie la capogruppo quando titolo e filiale si somigliano (sola lettura).
grant select (gruppo_id) on public.aziende to agente_calendario;
