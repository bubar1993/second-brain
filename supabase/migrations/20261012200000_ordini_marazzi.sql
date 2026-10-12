-- Conferme d'ordine Marazzi (12.10.2026, ok di Giovanni). La funzione ordini-marazzi (ogni 15 minuti)
-- le trova nella Gmail di Giovanni e salva il testo del PDF; la routine "Ordini Marazzi" (agente_ceramex)
-- legge il testo, riempie cliente, righe e disponibilità e scrive la nota nella scheda del cliente (sezione ordini).
-- L'app mostra gli ordini degli ultimi 2 giorni (Dentro → Ordini Marazzi, solo Ceramex).
create table public.ordini_marazzi (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null default utente_predefinito() references auth.users(id) on delete cascade,
  gmail_message_id text not null unique,
  gmail_thread_id text,
  data timestamptz not null,            -- quando è arrivata la conferma
  oggetto text,
  destinatari text[] not null default '{}',
  numeri text[] not null default '{}',  -- numeri d'ordine Marazzi (dall'oggetto)
  riferimento text,                     -- riferimento del cliente (PO / Vs rif.)
  nome_pdf text,
  testo_pdf text,
  stato text not null default 'da_leggere' check (stato in ('da_leggere', 'letto', 'errore')),
  errore text,
  -- riempiti dall'agente:
  azienda_id uuid references public.aziende(id) on delete set null,
  cliente text,                         -- nome breve del cliente come lo chiama Giovanni
  righe jsonb not null default '[]',    -- [{articolo, codice, formato, quantita, unita, disponibilita, data}]
  riepilogo text,                       -- una riga: cosa ha ordinato e se è disponibile
  disponibile text check (disponibile in ('si', 'in_parte', 'no', 'non_detto')),
  nota_id uuid references public.note(id) on delete set null,
  letto_il timestamptz,
  creata_il timestamptz not null default now()
);
create index ordini_marazzi_data_idx on public.ordini_marazzi (data desc);
create index ordini_marazzi_stato_idx on public.ordini_marazzi (stato) where stato = 'da_leggere';

alter table public.ordini_marazzi enable row level security;
create policy "solo proprietario" on public.ordini_marazzi for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "connettori solo lettura (ins)" on public.ordini_marazzi as restrictive for insert to authenticated with check ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (mod)" on public.ordini_marazzi as restrictive for update to authenticated using ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (canc)" on public.ordini_marazzi as restrictive for delete to authenticated using ((auth.jwt() ->> 'client_id') is null);

-- L'agente Ceramex legge le conferme e riempie solo i suoi campi.
grant select on public.ordini_marazzi to agente_ceramex;
grant update (stato, errore, azienda_id, cliente, righe, riepilogo, disponibile, nota_id, letto_il) on public.ordini_marazzi to agente_ceramex;
create policy "agente ceramex" on public.ordini_marazzi for select to agente_ceramex using (true);
create policy "agente ceramex legge" on public.ordini_marazzi for update to agente_ceramex using (true) with check (true);
