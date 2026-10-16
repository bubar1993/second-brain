-- Allegati nelle bozze G&C (16.10.2026, ok di Giovanni).
-- Elenco dei file allegati alla risposta: [{nome, percorso, tipo, dimensione}].
-- I file stanno nel bucket "allegati" (cartella <utente>/bozze/<id bozza>/), li legge invia-bozza al momento dell'invio.
alter table public.bozze add column if not exists allegati jsonb not null default '[]'::jsonb;
