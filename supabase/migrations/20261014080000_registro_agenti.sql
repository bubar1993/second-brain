-- Registro dei giri (14.10.2026): gli agenti scrivevano la loro riga con "returning", che vuole anche il permesso
-- di lettura; senza, il database rispondeva "permission denied" e il giro restava senza traccia (agente Ceramex:
-- circa 7 giri su 21 il 13.10). Ogni agente può rileggere SOLO le proprie righe.
grant select on public.lavori_registro to agente_ceramex, agente_gc, agente_lavoro, agente_privato, agente_calendario;

drop policy if exists "agente ceramex legge" on public.lavori_registro;
create policy "agente ceramex legge" on public.lavori_registro for select to agente_ceramex using (lavoro like 'agente-ceramex%');
drop policy if exists "agente gc legge" on public.lavori_registro;
create policy "agente gc legge" on public.lavori_registro for select to agente_gc using (lavoro like 'agente-gc%');
drop policy if exists "agente lavoro legge" on public.lavori_registro;
create policy "agente lavoro legge" on public.lavori_registro for select to agente_lavoro using (lavoro like 'agente-lavoro%');
drop policy if exists "agente privato legge" on public.lavori_registro;
create policy "agente privato legge" on public.lavori_registro for select to agente_privato using (lavoro like 'agente-privato%');
drop policy if exists "agente calendario legge" on public.lavori_registro;
create policy "agente calendario legge" on public.lavori_registro for select to agente_calendario using (lavoro = 'agente-calendario');
