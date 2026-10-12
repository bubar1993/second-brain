-- Smistatore: lavori in due tempi (es. cliente nuovo G&C: prima l'archiviazione lo crea nel gestionale, poi, quando
-- la copia lo porta nel second brain, l'agente lavoro collega la nota). Il seguito sta nella prima richiesta e lo
-- smistatore lo manda quando la prima è fatta.
alter table public.richieste_agenti add column if not exists seguito_agente text
  check (seguito_agente in ('lavoro', 'ceramex', 'gc', 'calendario', 'archiviazione'));
alter table public.richieste_agenti add column if not exists seguito_testo text;
