-- Mail private al Capo (13.10.2026 sera, ok di Giovanni): l'agente Ceramex, quando nella Gmail trova una mail privata
-- (scuola, AGISTT, famiglia, medico, casa…), non la tratta lui: scrive una richiesta al Capo (da = 'ceramex') e lo fa
-- partire con agente-subito. Il Capo legge la mail e fa nota/promemoria nel Privato o propone il cambio da confermare.
-- L'agente Ceramex vede solo le sue segnalazioni al Capo (non le richieste di Giovanni) e non legge il Privato.

alter table public.richieste_agenti drop constraint if exists richieste_agenti_da_check;
alter table public.richieste_agenti add constraint richieste_agenti_da_check check (da in ('giovanni', 'smistatore', 'capo', 'ceramex'));

grant insert (agente, da, testo) on public.richieste_agenti to agente_ceramex;
create policy "ceramex segnala al capo" on public.richieste_agenti for insert to agente_ceramex
  with check (agente = 'capo' and da = 'ceramex');
create policy "ceramex vede le sue segnalazioni" on public.richieste_agenti for select to agente_ceramex
  using (agente = 'capo' and da = 'ceramex');

-- Mail viste: 'capo' = mail privata passata al Capo (così non la passa due volte).
alter table public.mail_viste drop constraint if exists mail_viste_esito_check;
alter table public.mail_viste add constraint mail_viste_esito_check check (esito in ('nota', 'niente', 'capo'));

-- Conferme del Capo: 'calendario' = creare o cambiare un appuntamento nato da una mail (non chiesto da Giovanni).
alter table public.capo_conferme drop constraint if exists capo_conferme_tipo_check;
alter table public.capo_conferme add constraint capo_conferme_tipo_check
  check (tipo in ('mail', 'messaggio', 'cancella', 'gestionale', 'sposta_mail', 'calendario', 'altro'));
