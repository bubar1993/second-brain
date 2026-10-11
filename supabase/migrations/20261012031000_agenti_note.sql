-- Second Brain GF – Agenti delle note (ok di Giovanni, 12.10.2026 notte).
-- Due utenti del database, con permessi separati (le routine Claude in cloud li usano via agente-sql):
-- - agente_lavoro: aree Ceramex (C) e G&C (G). In più fa lo SMISTATORE: legge le note dell'Inbox
--   (area vuota) e i WhatsApp di contatti non ancora assegnati, e decide l'area. Non vede il Privato.
-- - agente_privato: solo area Privato (P). Non vede il lavoro.
-- Nessuno dei due cancella note, persone o aziende. Le password le imposta scripts/collega-agente.mjs.

-- Aree di una persona, viste dal database (serve ai permessi: una persona solo privata
-- resta invisibile all'agente del lavoro anche se lui non vede le righe del Privato).
create or replace function public.aree_persona(pid uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(area), '{}') from public.persone_aree where persona_id = pid
$$;
create or replace function public.area_contatto_wa(w text) returns text
language sql stable security definer set search_path = '' as $$
  select area from public.wa_contatti where wa_id = w
$$;

do $$
declare
  ruolo text;
begin
  foreach ruolo in array array['agente_lavoro', 'agente_privato'] loop
    execute format('create role %I nologin noinherit', ruolo);
    execute format('grant usage on schema public to %I', ruolo);
    execute format('grant select on public.aree, public.aziende, public.note, public.persone, public.persone_aree,
      public.persone_aziende, public.persone_riassunti, public.note_persone, public.promemoria, public.domande,
      public.regole_agenti, public.wa_contatti, public.wa_messaggi, public.allegati to %I', ruolo);
    execute format('grant insert, update on public.note, public.persone, public.persone_aree, public.persone_aziende,
      public.persone_riassunti, public.promemoria, public.domande, public.regole_agenti to %I', ruolo);
    execute format('grant insert, delete on public.note_persone to %I', ruolo);
    execute format('grant update (area, azienda_id, persona_id, note, nome_rubrica) on public.wa_contatti to %I', ruolo);
    execute format('grant update (area, vista_il, esito, motivo) on public.wa_messaggi to %I', ruolo);
    execute format('grant insert on public.lavori_registro to %I', ruolo);
    execute format('grant usage on sequence public.lavori_registro_id_seq to %I', ruolo);
    execute format('grant execute on function public.utente_predefinito(), public.aree_persona(uuid),
      public.area_contatto_wa(text), public.numero_internazionale(text) to %I', ruolo);
  end loop;
end $$;

-- Solo il lavoro legge cantieri, fornitori, mail G&C e lo stile dei contatti.
grant select on public.cantieri, public.fornitori, public.posta, public.contatti_stile to agente_lavoro;
create policy "agente lavoro" on public.cantieri for select to agente_lavoro using (area in ('C','G'));
create policy "agente lavoro" on public.fornitori for select to agente_lavoro using (area in ('C','G'));
create policy "agente lavoro" on public.posta for select to agente_lavoro using (area in ('C','G'));
create policy "agente lavoro" on public.contatti_stile for select to agente_lavoro using (area in ('C','G'));

-- ---------------------------------------------------------------
-- agente_lavoro: C e G (+ Inbox da smistare)
-- ---------------------------------------------------------------
create policy "agente lavoro" on public.aziende for select to agente_lavoro using (area in ('C','G'));
create policy "agente lavoro legge" on public.note for select to agente_lavoro using (area in ('C','G') or area is null);
create policy "agente lavoro scrive" on public.note for insert to agente_lavoro with check (area in ('C','G'));
-- Le note copiate da Ceramex le corregge il gestionale (fino allo switch): l'agente non le cambia.
create policy "agente lavoro smista" on public.note for update to agente_lavoro
  using ((area in ('C','G') and not da_ceramex) or area is null) with check (area in ('C','G','P'));
create policy "agente lavoro" on public.persone for select to agente_lavoro
  using (public.aree_persona(id) && array['C','G'] or cardinality(public.aree_persona(id)) = 0);
create policy "agente lavoro crea" on public.persone for insert to agente_lavoro with check (true);
create policy "agente lavoro cambia" on public.persone for update to agente_lavoro
  using (public.aree_persona(id) && array['C','G'] or cardinality(public.aree_persona(id)) = 0);
create policy "agente lavoro" on public.persone_aree for all to agente_lavoro using (area in ('C','G')) with check (area in ('C','G'));
create policy "agente lavoro" on public.persone_aziende for all to agente_lavoro
  using (exists (select 1 from public.aziende a where a.id = azienda_id)) with check (exists (select 1 from public.aziende a where a.id = azienda_id));
create policy "agente lavoro" on public.persone_riassunti for all to agente_lavoro using (area in ('C','G')) with check (area in ('C','G'));
create policy "agente lavoro" on public.note_persone for all to agente_lavoro
  using (exists (select 1 from public.note n where n.id = nota_id)) with check (exists (select 1 from public.note n where n.id = nota_id));
create policy "agente lavoro" on public.allegati for select to agente_lavoro using (exists (select 1 from public.note n where n.id = nota_id));
create policy "agente lavoro" on public.promemoria for all to agente_lavoro using (area in ('C','G')) with check (area in ('C','G'));
create policy "agente lavoro" on public.domande for all to agente_lavoro
  using (area in ('C','G') or (area is null and agente = 'lavoro')) with check (area in ('C','G') or (area is null and agente = 'lavoro'));
create policy "agente lavoro" on public.regole_agenti for all to agente_lavoro using (area in ('C','G')) with check (area in ('C','G'));
create policy "agente lavoro" on public.wa_contatti for select to agente_lavoro using (area in ('C','G') or area is null);
create policy "agente lavoro smista" on public.wa_contatti for update to agente_lavoro
  using (area in ('C','G') or area is null) with check (area in ('C','G','P') or area is null);
create policy "agente lavoro" on public.wa_messaggi for select to agente_lavoro
  using (coalesce(public.area_contatto_wa(wa_id), 'X') in ('C','G','X'));
create policy "agente lavoro smista" on public.wa_messaggi for update to agente_lavoro
  using (coalesce(public.area_contatto_wa(wa_id), 'X') in ('C','G','X'));
create policy "agente lavoro" on public.lavori_registro for insert to agente_lavoro with check (lavoro like 'agente-lavoro%');

-- ---------------------------------------------------------------
-- agente_privato: solo P
-- ---------------------------------------------------------------
create policy "agente privato" on public.aziende for select to agente_privato using (area = 'P');
create policy "agente privato" on public.note for select to agente_privato using (area = 'P');
create policy "agente privato scrive" on public.note for insert to agente_privato with check (area = 'P');
create policy "agente privato cambia" on public.note for update to agente_privato using (area = 'P') with check (area = 'P');
create policy "agente privato" on public.persone for select to agente_privato
  using ('P' = any(public.aree_persona(id)) or cardinality(public.aree_persona(id)) = 0);
create policy "agente privato crea" on public.persone for insert to agente_privato with check (true);
create policy "agente privato cambia" on public.persone for update to agente_privato
  using ('P' = any(public.aree_persona(id)) or cardinality(public.aree_persona(id)) = 0);
create policy "agente privato" on public.persone_aree for all to agente_privato using (area = 'P') with check (area = 'P');
create policy "agente privato" on public.persone_aziende for all to agente_privato
  using (exists (select 1 from public.aziende a where a.id = azienda_id)) with check (exists (select 1 from public.aziende a where a.id = azienda_id));
create policy "agente privato" on public.persone_riassunti for all to agente_privato using (area = 'P') with check (area = 'P');
create policy "agente privato" on public.note_persone for all to agente_privato
  using (exists (select 1 from public.note n where n.id = nota_id)) with check (exists (select 1 from public.note n where n.id = nota_id));
create policy "agente privato" on public.allegati for select to agente_privato using (exists (select 1 from public.note n where n.id = nota_id));
create policy "agente privato" on public.promemoria for all to agente_privato using (area = 'P') with check (area = 'P');
create policy "agente privato" on public.domande for all to agente_privato
  using (area = 'P' or (area is null and agente = 'privato')) with check (area = 'P' or (area is null and agente = 'privato'));
create policy "agente privato" on public.regole_agenti for all to agente_privato using (area = 'P') with check (area = 'P');
create policy "agente privato" on public.wa_contatti for select to agente_privato using (area = 'P');
create policy "agente privato cambia" on public.wa_contatti for update to agente_privato using (area = 'P') with check (area = 'P');
create policy "agente privato" on public.wa_messaggi for select to agente_privato using (public.area_contatto_wa(wa_id) = 'P');
create policy "agente privato cambia" on public.wa_messaggi for update to agente_privato using (public.area_contatto_wa(wa_id) = 'P');
create policy "agente privato" on public.lavori_registro for insert to agente_privato with check (lavoro like 'agente-privato%');
