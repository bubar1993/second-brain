-- Il "Medico" del guardiano (22.10.2026, ok di Giovanni): quando si apre un guasto, l'AI (crediti API del piano Max)
-- scrive in parole semplici cosa vuol dire e cosa fare. Solo testo: non ripara niente. La scrive la funzione guardiano.
alter table public.guasti add column spiegazione text;
