-- Chat di prova (26.10.2026, Giovanni: "gli agenti la ignorano"). Dal numero di prova di Meta +1 555 645 6202
-- partono gli avvisi del Guardiano: ora che il numero di Giovanni è collegato al Brain, ogni avviso entra anche qui
-- come messaggio. Si segnano subito come visti, così nessun agente li lavora. Niente si cancella e gli avvisi
-- continuano ad arrivare sul telefono come prima.
create or replace function public.wa_numero_prova() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.wa_id = '15556456202' then
    new.vista_il := coalesce(new.vista_il, now());
    new.esito := coalesce(new.esito, 'niente');
    new.motivo := coalesce(new.motivo, 'Avviso del Guardiano dal numero di prova di Meta');
  end if;
  return new;
end $$;
create trigger wa_numero_prova before insert or update on public.wa_messaggi
  for each row execute function public.wa_numero_prova();

update public.wa_messaggi set vista_il = now() where wa_id = '15556456202' and vista_il is null;
