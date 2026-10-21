-- Saluto diverso in giorni precisi (21.10.2026, Giovanni): questa settimana niente Davide e Celeste.
alter table public.sonos_sveglie add column eccezioni jsonb not null default '{}'::jsonb;
update public.sonos_sveglie
set eccezioni = '{"2026-10-22": "Buongiorno Leo e Jolie, dormito bene?", "2026-10-23": "Buongiorno Leo e Jolie, dormito bene?"}'
where nome = 'Bimbi gio-ven';
