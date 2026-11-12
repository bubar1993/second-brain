-- WhatsApp per l'agente bozze Ceramex (12.11.2026, ok di Giovanni, piano controllato dall'antagonista).
-- Giovanni: "puoi guardare nelle mail o in caso di WhatsApp, nella chat di Davide Lonardi, se c'è un'offerta di quella data,
-- prepararmi già la bozza [...] per Sara" e "anche questo è un WhatsApp di lavoro [...] potrebbe già farmi in bozza l'ordine".
-- Solo LETTURA, solo le chat con l'area Ceramex e senza il Privato (regola Lavoro/Privato), solo le colonne che servono:
-- niente grezzo/media dei messaggi né note sul contatto. Nessun update: le note WhatsApp le fa l'agente lavoro.
-- Per tornare indietro: revoke select on public.wa_messaggi, public.wa_contatti from agente_ceramex; drop policy ...

grant select (id, wa_id, direzione, tipo, testo, data) on public.wa_messaggi to agente_ceramex;
grant select (wa_id, nome_rubrica, nome_profilo, area, azienda_id, persona_id) on public.wa_contatti to agente_ceramex;

drop policy if exists "agente ceramex" on public.wa_messaggi;
drop policy if exists "agente ceramex" on public.wa_contatti;
create policy "agente ceramex" on public.wa_messaggi for select to agente_ceramex
  using ('C' = any(public.aree_contatto_wa(wa_id)) and not ('P' = any(public.aree_contatto_wa(wa_id))));
create policy "agente ceramex" on public.wa_contatti for select to agente_ceramex
  using ('C' = any(public.aree_contatto_wa(wa_id)) and not ('P' = any(public.aree_contatto_wa(wa_id))));
