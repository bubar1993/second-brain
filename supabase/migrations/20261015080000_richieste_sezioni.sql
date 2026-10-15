-- Sezioni nelle chat del Capo e degli agenti (15.10.2026, scelta di Giovanni).
-- sezione_id = la prima richiesta della sezione; vuota = la richiesta apre una sezione sua.
-- La mette solo l'app quando Giovanni continua un argomento: agenti e funzioni non la toccano.
alter table public.richieste_agenti
  add column if not exists sezione_id uuid references public.richieste_agenti(id) on delete set null;
