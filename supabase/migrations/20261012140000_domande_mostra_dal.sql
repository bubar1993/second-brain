-- Domande da far vedere più tardi (12.10.2026, Giovanni: la domanda sui gemelli "rifalla questa sera verso le 20").
alter table public.domande add column if not exists mostra_dal timestamptz;
update public.domande set mostra_dal = '2026-10-12 20:00:00+02'
 where agente = 'privato' and risposta_il is null and testo like 'Gemelli:%';
