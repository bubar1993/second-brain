-- Unendo due schede G&C doppie, anche le mail di info@ passano sulla scheda tenuta.
grant update (azienda_id) on public.posta to agente_seguire;
create policy "agente seguire sposta" on public.posta for update to agente_seguire using (area = 'G') with check (area = 'G');
