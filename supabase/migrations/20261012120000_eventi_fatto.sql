-- Oggi: spunta "fatto" anche sugli appuntamenti (12.10.2026, richiesta di Giovanni).
-- Solo nel second brain: in Google Calendar l'evento resta com'è. L'agente calendario non tocca questa colonna.
alter table public.eventi add column if not exists fatto_il timestamptz;
