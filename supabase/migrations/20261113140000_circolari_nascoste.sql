-- Circolari: Giovanni le può cancellare e modificare dall'app (13.11.2026, ok di Giovanni, piano controllato dall'antagonista).
-- "Cancella" è morbida: la riga resta con nascosta_il, così l'agente "da seguire" (che controlla message_id) non la ricrea.
-- Le letture dell'app filtrano nascosta_il is null. Grant e regole esistenti bastano.
alter table public.circolari add column if not exists nascosta_il timestamptz;
