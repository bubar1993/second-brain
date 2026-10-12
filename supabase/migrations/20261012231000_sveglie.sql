-- Ultima partenza "a richiesta" di una routine (funzione agente-subito): serve a non far partire lo smistatore
-- dieci volte di fila quando Giovanni risponde a dieci domande una dopo l'altra. La usa solo la funzione.
create table public.sveglie (
  agente text primary key,
  ultima timestamptz not null default now()
);
alter table public.sveglie enable row level security;
revoke all on public.sveglie from anon, authenticated;
