-- Riordino anche della Gmail Ceramex (12.10.2026 notte, ok di Giovanni).
-- Stessa tabella riordino_mail, con la casella: 'gc' = info@ su Hostpoint (cartelle IMAP), 'ceramex' = Gmail di
-- giovannifabris@ceramex.ch (etichette). Per Ceramex una riga = una conversazione Gmail in Posta in arrivo
-- (message_id = 'gmail-thread:<id>'); "Sposta" = mette l'etichetta e toglie dalla Posta in arrivo (funzione riordino-mail).
-- Le proposte Ceramex le scrive l'agente "Bozze mail Ceramex" (utente agente_ceramex), quelle G&C l'archiviazione (agente_gc).
alter table public.riordino_mail add column casella text not null default 'gc' check (casella in ('gc', 'ceramex'));
alter table public.riordino_mail add column gmail_thread_id text;
alter table public.riordino_mail add column n_messaggi integer;
drop index if exists riordino_mail_stato_idx;
create index riordino_mail_stato_idx on public.riordino_mail (casella, stato, cartella_da, data_email desc);

-- Ogni agente vede e propone solo nella sua casella.
drop policy "agente gc legge" on public.riordino_mail;
drop policy "agente gc propone" on public.riordino_mail;
drop policy "agente gc aggiorna" on public.riordino_mail;
create policy "agente gc legge" on public.riordino_mail for select to agente_gc using (casella = 'gc');
create policy "agente gc propone" on public.riordino_mail for insert to agente_gc with check (casella = 'gc' and stato = 'proposta');
create policy "agente gc aggiorna" on public.riordino_mail for update to agente_gc
  using (casella = 'gc' and stato in ('proposta', 'sparita')) with check (casella = 'gc' and stato in ('proposta', 'sparita'));

grant select, insert on public.riordino_mail to agente_ceramex;
grant update (uid, data_email, da, oggetto, non_letta, stellina, cartella_proposta, nuova, dubbio, motivo, stato, aggiornata_il, n_messaggi)
  on public.riordino_mail to agente_ceramex;
grant update (n_messaggi) on public.riordino_mail to agente_gc;
grant execute on function public.utente_predefinito() to agente_ceramex;
create policy "agente ceramex legge" on public.riordino_mail for select to agente_ceramex using (casella = 'ceramex');
create policy "agente ceramex propone" on public.riordino_mail for insert to agente_ceramex
  with check (casella = 'ceramex' and stato = 'proposta' and cartella_da = 'INBOX');
create policy "agente ceramex aggiorna" on public.riordino_mail for update to agente_ceramex
  using (casella = 'ceramex' and stato in ('proposta', 'sparita')) with check (casella = 'ceramex' and stato in ('proposta', 'sparita'));
