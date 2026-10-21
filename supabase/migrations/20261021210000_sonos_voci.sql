-- Voci degli annunci Sonos (21.10.2026): bucket privato, lo usa solo la funzione `sonos` (chiave di servizio).
-- Nessuna regola per l'app: Sonos riceve un link firmato che vale 10 minuti.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voci', 'voci', false, 5242880, array['audio/wav'])
on conflict (id) do nothing;
