-- Avvisi di sicurezza di Supabase (27.11.2026, ok di Giovanni, antagonista).
-- 1. Le viste wa_stato e sonos_stato mostrano all'app solo lo stato del collegamento, senza le chiavi che stanno nelle
--    tabelle wa_collegamento e sonos_collegamento. Devono restare "security definer" (l'app non puo' leggere le tabelle):
--    l'avviso di Supabase su questo resta, ed e' voluto. Ma oggi l'app potrebbe anche SCRIVERCI (insert/update/delete),
--    e una vista semplice scrive nella tabella sotto con i permessi del proprietario: si lascia solo la lettura.
revoke insert, update, delete, truncate, references, trigger on public.wa_stato from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.sonos_stato from authenticated;

-- 2. Il controllo delle conferme del Capo non usa tabelle (solo current_user, new e old): gli si fissa il search_path.
alter function public.capo_conferme_controllo() set search_path = '';
