-- 10.11.2026, ok di Giovanni (controllo dell'antagonista fatto).
-- 1) Motivo dello scarto di una bozza: 'a_voce' (già sentito a voce: la bozza era giusta), 'non_serviva',
--    'sbagliata' (con una riga facoltativa). Vuoto = scarti vecchi o senza motivo: nessuna lezione negativa.
alter table public.bozze
  add column if not exists motivo_scarto text check (motivo_scarto is null or motivo_scarto in ('a_voce', 'non_serviva', 'sbagliata')),
  add column if not exists nota_scarto text;

-- 2) L'agente Ceramex LEGGE (solo lettura, solo queste colonne, solo le bozze Gmail dell'area C) cosa ha fatto
--    Giovanni nell'app: scartata e perché, inviata dall'app con o senza correzioni. Senza, scambiava uno scarto
--    seguito da una mail scritta a mano per una "correzione" della bozza.
grant select (id, area, canale, stato, motivo_scarto, nota_scarto, testo, testo_agente, inviata_message_id, inviata_il, modificata_il)
  on public.bozze to agente_ceramex;
drop policy if exists "agente ceramex legge" on public.bozze;
create policy "agente ceramex legge" on public.bozze for select to agente_ceramex using (area = 'C' and canale = 'gmail');

-- 3) Liste fisse di destinatari per gli invii che si ripetono (portafogli Crea Ceram del martedì).
--    La legge e la scrive solo la funzione `portafogli` (service_role): niente app, niente agenti, niente connettori.
create table if not exists public.liste_invio (
  chiave text primary key,
  oggetto text not null,
  a text[] not null default '{}',
  cc text[] not null default '{}',
  aggiornata_il timestamptz not null default now()
);
alter table public.liste_invio enable row level security;
revoke all on public.liste_invio from public, anon, authenticated;
grant select, insert, update on public.liste_invio to service_role;

-- 4) Una sola bozza dei portafogli per settimana, anche se due giri partono insieme.
create unique index if not exists bozze_portafogli_settimana on public.bozze ((perche->>'settimana'))
  where perche->>'tipo' = 'portafogli_crea';

-- 5) Il martedì ogni 15 minuti, dalle 7 alle 19 di Zurigo (6-17 UTC copre ora solare e legale): guarda se è
--    arrivata la mail di Sara e prepara la bozza. La chiave sta nella cassaforte, non qui.
select cron.schedule('portafogli-crea', '*/15 6-17 * * 2', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/portafogli',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);
