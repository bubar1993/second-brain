-- Appuntamenti spostati o corretti dall'app (richiesta di Giovanni, 12.10.2026).
-- L'app scrive qui il cambio (titolo, inizio, fine, luogo, tutto_il_giorno) e lo mostra subito;
-- l'agente calendario lo porta in Google Calendar sullo STESSO evento, poi copia i valori e svuota il cambio.
-- Così appunti, note e collegamenti dell'appuntamento restano dove sono.
alter table public.eventi add column if not exists cambio jsonb;
alter table public.eventi add column if not exists cambio_il timestamptz;
