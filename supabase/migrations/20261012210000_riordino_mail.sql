-- Riordino della casella info@ nell'app (12.10.2026 sera, ok di Giovanni).
-- L'agente "Archiviazione email G&C" (ogni 2 ore) propone in quale cartella di Hostpoint spostare ogni mail
-- di Posta in arrivo (INBOX) e Posta inviata (Sent); Giovanni nell'app spunta quelle che vanno bene e preme
-- "Sposta": la funzione riordino-mail le sposta subito (IMAP MOVE). Niente si sposta senza il suo tocco.
-- Sostituisce la proposta serale in chat (Cowork "Riordino casella Hostpoint", tabella private.riordino_hostpoint
-- del gestionale G&C, che resta lì come storico).
create table public.riordino_mail (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  cartella_da text not null check (cartella_da in ('INBOX', 'Sent')),
  uid integer,                     -- uid al momento della proposta (allo spostamento si ricerca col message_id)
  message_id text not null unique,
  data_email timestamptz,
  da text,                         -- mittente (posta in arrivo) o destinatario (posta inviata)
  oggetto text,
  non_letta boolean not null default false,
  stellina boolean not null default false,
  cartella_proposta text,          -- null = da decidere (dubbio)
  nuova boolean not null default false,   -- cartella che non esiste ancora: si crea solo se Giovanni la approva
  dubbio text,                     -- domanda corta quando l'agente non sa dove metterla
  motivo text,
  stato text not null default 'proposta'
    check (stato in ('proposta', 'in_spostamento', 'spostata', 'tenere', 'sparita')),
  cartella_finale text,
  esito text,
  proposta_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  spostata_il timestamptz
);
create index riordino_mail_stato_idx on public.riordino_mail (stato, cartella_da, data_email desc);

alter table public.riordino_mail enable row level security;
create policy "solo proprietario" on public.riordino_mail for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "connettori solo lettura (ins)" on public.riordino_mail as restrictive for insert to authenticated with check ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (mod)" on public.riordino_mail as restrictive for update to authenticated using ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (canc)" on public.riordino_mail as restrictive for delete to authenticated using ((auth.jwt() ->> 'client_id') is null);

-- L'agente G&C (archiviazione) scrive le proposte: aggiunge righe e aggiorna solo quelle ancora in proposta
-- (o sparite). Non tocca quelle che Giovanni ha tenuto o spostato, non sposta niente, non cancella.
grant select, insert on public.riordino_mail to agente_gc;
grant update (uid, data_email, da, oggetto, non_letta, stellina, cartella_proposta, nuova, dubbio, motivo, stato, aggiornata_il)
  on public.riordino_mail to agente_gc;
create policy "agente gc legge" on public.riordino_mail for select to agente_gc using (true);
create policy "agente gc propone" on public.riordino_mail for insert to agente_gc with check (stato = 'proposta');
create policy "agente gc aggiorna" on public.riordino_mail for update to agente_gc
  using (stato in ('proposta', 'sparita')) with check (stato in ('proposta', 'sparita'));
