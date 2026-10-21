-- Tasto "Manda a Claude" sui guasti in Oggi (21.10.2026, Giovanni): il guasto diventa una riga di
-- modifiche_claude già con l'ok (la manda Giovanni stesso); Claude la trova all'inizio della sessione.
alter table public.modifiche_claude add column guasto_id uuid references public.guasti(id) on delete set null;
create unique index modifiche_claude_un_guasto on public.modifiche_claude (guasto_id) where guasto_id is not null;
