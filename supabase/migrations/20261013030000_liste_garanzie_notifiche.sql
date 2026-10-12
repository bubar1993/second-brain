-- Privato e comodità (notte del 13.10.2026, ok di Giovanni):
-- 1. Liste: solo Spesa e Ristoranti e posti. Si riempiono dettando dal + ("metti il latte nella spesa").
-- 2. Garanzie: foto dello scontrino dal + con "garanzia lavatrice Fust 2 anni". Nessun avviso di scadenza, solo l'elenco.
-- 3. Notifiche sul telefono (Web Push, gratis): appuntamenti 1 ora prima (lavoro e privato), promemoria urgenti
--    all'ora, risposte e conferme del Capo. Niente notifiche di prova.

-- 1. Liste
create table public.liste_voci (
  id          uuid primary key default gen_random_uuid(),
  utente_id   uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  lista       text not null check (lista in ('spesa', 'ristoranti')),
  testo       text not null,
  dettagli    text,                                 -- ristoranti: dove, chi l'ha consigliato, cosa prendere
  provato     boolean not null default false,       -- ristoranti: già provato?
  voto        int check (voto between 1 and 5),     -- ristoranti: stelle
  fatta_il    timestamptz,                          -- spesa: comprato (sparisce dalla lista)
  nota_id     uuid references public.note(id) on delete set null,
  creata_il   timestamptz not null default now(),
  modificata_il timestamptz not null default now(),
  eliminata_il timestamptz
);
create index liste_voci_lista on public.liste_voci (lista, fatta_il) where eliminata_il is null;

-- 2. Garanzie (la foto sta negli allegati della nota)
create table public.garanzie (
  id            uuid primary key default gen_random_uuid(),
  utente_id     uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  cosa          text not null,
  negozio       text,
  comprata_il   date not null default current_date,
  mesi          int not null default 24 check (mesi between 1 and 240),   -- in Svizzera di solito 2 anni
  scade_il      date generated always as ((comprata_il + make_interval(months => mesi))::date) stored,
  nota_id       uuid references public.note(id) on delete set null,
  creata_il     timestamptz not null default now(),
  modificata_il timestamptz not null default now(),
  eliminata_il  timestamptz
);

-- 3. Notifiche: i telefoni iscritti e quello che è già stato mandato (per non mandarlo due volte).
create table public.push_iscrizioni (
  id          uuid primary key default gen_random_uuid(),
  utente_id   uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  dispositivo text,
  creata_il   timestamptz not null default now(),
  ultima_ok   timestamptz,
  errore      text
);
create table public.notifiche_inviate (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('appuntamento', 'promemoria', 'capo_risposta', 'capo_conferma')),
  rif_id     uuid not null,
  chiave     text not null default '',      -- l'ora dell'appuntamento/promemoria: se lo sposti, avvisa di nuovo
  titolo     text,
  inviata_il timestamptz not null default now(),
  unique (tipo, rif_id, chiave)
);

alter table public.liste_voci enable row level security;
alter table public.garanzie enable row level security;
alter table public.push_iscrizioni enable row level security;
alter table public.notifiche_inviate enable row level security;
revoke all on public.liste_voci, public.garanzie, public.push_iscrizioni, public.notifiche_inviate from anon;
grant select, insert, update, delete on public.liste_voci, public.garanzie, public.push_iscrizioni to authenticated;
grant select on public.notifiche_inviate to authenticated;
create policy "solo proprietario" on public.liste_voci for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.garanzie for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.push_iscrizioni for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo lettura" on public.notifiche_inviate for select to authenticated using (true);

-- Connettori (app Claude): solo lettura, come per le altre tabelle.
do $$
declare t text;
begin
  foreach t in array array['liste_voci', 'garanzie', 'push_iscrizioni'] loop
    execute format('create policy "connettori solo lettura (ins)" on public.%I as restrictive for insert to authenticated with check ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (mod)" on public.%I as restrictive for update to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (canc)" on public.%I as restrictive for delete to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
  end loop;
end $$;

-- L'agente privato vede e aggiorna liste e garanzie (niente cancellazioni).
grant select, insert, update on public.liste_voci, public.garanzie to agente_privato;
create policy "agente privato" on public.liste_voci for all to agente_privato using (true) with check (true);
create policy "agente privato" on public.garanzie for all to agente_privato using (true) with check (true);

-- Il capo vede tutto (blocco della migrazione capo), ma non le iscrizioni dei telefoni.
do $$
declare t text;
begin
  foreach t in array array['liste_voci', 'garanzie', 'notifiche_inviate'] loop
    execute format('grant select, insert, update on public.%I to agente_capo', t);
    execute format('drop policy if exists "capo" on public.%I', t);
    execute format('create policy "capo" on public.%I for all to agente_capo using (true) with check (true)', t);
  end loop;
end $$;

-- Ogni 5 minuti: la funzione "notifiche" guarda cosa c'è da avvisare.
select cron.schedule('notifiche', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/notifiche',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{}'::jsonb, timeout_milliseconds := 20000)
$$);

-- Pulizia: le notifiche mandate si tengono 30 giorni.
select cron.schedule('notifiche-pulizia', '40 3 * * *',
  $$ delete from public.notifiche_inviate where inviata_il < now() - interval '30 days' $$);
