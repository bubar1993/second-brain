-- Second Brain GF – Riordino casella: Giovanni risponde all'agente su una mail (13.10.2026, ok di Giovanni).
-- La risposta è una richiesta all'agente "archiviazione" legata alla riga del riordino: l'app la mostra sotto la mail.
alter table public.richieste_agenti add column if not exists riordino_id uuid references public.riordino_mail(id) on delete set null;
create index if not exists richieste_agenti_riordino_idx on public.richieste_agenti (riordino_id) where riordino_id is not null;
