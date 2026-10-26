-- Second Brain GF – "La tua settimana" (26.10.2026, ok di Giovanni): la domenica dopo le 19 gli agenti lavoro e
-- privato scrivono anche il riassunto della settimana (momento 'settimana'). Oggi lo mostra domenica sera e lunedì.
-- Le policy degli agenti filtrano già per parte: niente permessi nuovi.

alter table public.riassunti_giorno drop constraint riassunti_giorno_momento_check;
alter table public.riassunti_giorno add constraint riassunti_giorno_momento_check
  check (momento in ('mattino', 'sera', 'settimana'));
