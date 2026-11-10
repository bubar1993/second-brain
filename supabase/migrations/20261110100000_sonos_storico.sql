-- Sveglie Sonos: storico delle ultime 30 mattine (10.11.2026, ok di Giovanni).
-- Prima restava solo l'ultimo errore: non si capiva da quanti giorni la musica non partiva.
-- Lo scrive solo la funzione `sonos` (service_role). Nessun permesso nuovo: la tabella resta com'è.
alter table public.sonos_sveglie add column if not exists storico jsonb not null default '[]'::jsonb;
