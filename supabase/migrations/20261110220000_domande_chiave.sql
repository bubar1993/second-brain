-- Second Brain GF – chiave delle domande (10.11.2026, ok di Giovanni, piano controllato dall'antagonista).
-- Persone nuove da mail e WhatsApp: l'agente lavoro chiede "Creo la scheda di X?", l'agente privato
-- "X sembra un contatto di lavoro, lo sposto?". La chiave (es. 'persona:wa:41796208125', 'persona:mail:x@y.ch',
-- 'area:wa:41796208125') impedisce di fare due volte la stessa domanda, anche dopo un No.
-- Gli agenti inseriscono con: insert ... on conflict (chiave) where chiave is not null do nothing.
alter table public.domande add column if not exists chiave text;
create unique index if not exists domande_chiave_idx on public.domande (chiave) where chiave is not null;

-- I permessi di inserire e cambiare le domande sono per colonna: si aggiunge la colonna nuova.
grant insert (chiave), update (chiave) on public.domande to agente_lavoro, agente_privato;
