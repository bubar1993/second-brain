-- Agente "Bozze mail Ceramex" spostato nel second brain (tappa 3, ok di Giovanni 12.10.2026).
-- Le note clienti Ceramex le scrive qui (non più nel gestionale). Utente del database "agente_ceramex":
-- vede e scrive SOLO l'area C (schede ditte, note, mail viste, regole delle note). Niente cancellazioni,
-- niente Privato, niente G&C. Le bozze restano nel gestionale Ceramex (le copia copia-ceramex).
create role agente_ceramex nologin noinherit;
grant usage on schema public to agente_ceramex;
grant execute on function public.utente_predefinito() to agente_ceramex;

grant select, insert, update on public.aziende to agente_ceramex;
grant select, insert, update on public.note to agente_ceramex;
grant select, insert, update on public.mail_viste to agente_ceramex;
grant select, insert, update on public.regole_agenti to agente_ceramex;
grant insert on public.lavori_registro to agente_ceramex;
grant usage on sequence public.lavori_registro_id_seq to agente_ceramex;

create policy "agente ceramex" on public.aziende for all to agente_ceramex using (area = 'C') with check (area = 'C');
create policy "agente ceramex legge" on public.note for select to agente_ceramex using (area = 'C');
create policy "agente ceramex scrive" on public.note for insert to agente_ceramex with check (area = 'C' and not da_ceramex);
-- Update su tutta l'area C: serve per segnare "imparata". Le regole del prompt gli vietano di cambiare il testo
-- delle note scritte da Giovanni o copiate dal gestionale.
create policy "agente ceramex cambia" on public.note for update to agente_ceramex using (area = 'C') with check (area = 'C');
create policy "agente ceramex" on public.mail_viste for all to agente_ceramex using (area = 'C') with check (area = 'C');
create policy "agente ceramex" on public.regole_agenti for all to agente_ceramex using (area = 'C') with check (area = 'C');
create policy "agente ceramex" on public.lavori_registro for insert to agente_ceramex with check (lavoro like 'agente-ceramex%');

-- Niente cancellazioni, comunque.
revoke delete, truncate on public.aziende, public.note, public.mail_viste, public.regole_agenti from agente_ceramex;
