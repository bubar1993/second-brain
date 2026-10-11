-- Second Brain GF – Fase 1: base
-- Aree, note (Inbox + Cestino), persone, promemoria, allegati.
-- Un solo utente (Giovanni): ogni riga ha utente_id e RLS "solo il proprietario".

-- ---------------------------------------------------------------
-- Aree (fisse: C, G, P)
-- ---------------------------------------------------------------
create table public.aree (
  codice  text primary key check (codice in ('C','G','P')),
  nome    text not null,
  colore  text not null,
  ordine  smallint not null
);

insert into public.aree (codice, nome, colore, ordine) values
  ('C', 'Ceramex', '#2563eb', 1),
  ('G', 'G&C',     '#16a34a', 2),
  ('P', 'Privato', '#ea580c', 3);

-- ---------------------------------------------------------------
-- Aggiorna modificata_il ad ogni modifica
-- ---------------------------------------------------------------
create function public.imposta_modificata_il()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.modificata_il := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Note. area null = Inbox. eliminata_il valorizzata = Cestino.
-- ---------------------------------------------------------------
create table public.note (
  id             uuid primary key default gen_random_uuid(),
  utente_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area           text references public.aree(codice),
  testo          text not null default '',
  fonte          text not null default 'scritta'
                 check (fonte in ('scritta','voce','foto','condivisa')),
  creata_il      timestamptz not null default now(),
  modificata_il  timestamptz not null default now(),
  eliminata_il   timestamptz
);

create index note_elenco_idx on public.note (utente_id, area, creata_il desc)
  where eliminata_il is null;
create index note_cestino_idx on public.note (eliminata_il)
  where eliminata_il is not null;

create trigger note_modificata before update on public.note
  for each row execute function public.imposta_modificata_il();

-- ---------------------------------------------------------------
-- Persone. Le aree di una persona stanno in persone_aree
-- (chi è in più aree sta nell'intersezione del diagramma).
-- ---------------------------------------------------------------
create table public.persone (
  id             uuid primary key default gen_random_uuid(),
  utente_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome           text not null,
  cognome        text,
  telefono       text,
  email          text,
  compleanno     date,
  creata_il      timestamptz not null default now(),
  modificata_il  timestamptz not null default now(),
  eliminata_il   timestamptz
);

create index persone_nome_idx on public.persone (utente_id, nome, cognome)
  where eliminata_il is null;

create trigger persone_modificata before update on public.persone
  for each row execute function public.imposta_modificata_il();

create table public.persone_aree (
  persona_id  uuid not null references public.persone(id) on delete cascade,
  area        text not null references public.aree(codice),
  utente_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (persona_id, area)
);

create index persone_aree_area_idx on public.persone_aree (area);

-- Collegamento nota ↔ persona. La nota resta nella sua area:
-- la scheda persona filtra per area, così il Privato non finisce mai nella scheda cliente.
create table public.note_persone (
  nota_id     uuid not null references public.note(id) on delete cascade,
  persona_id  uuid not null references public.persone(id) on delete cascade,
  utente_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (nota_id, persona_id)
);

create index note_persone_persona_idx on public.note_persone (persona_id);

-- ---------------------------------------------------------------
-- Promemoria (schermata Oggi)
-- ---------------------------------------------------------------
create table public.promemoria (
  id             uuid primary key default gen_random_uuid(),
  utente_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area           text references public.aree(codice),
  testo          text not null,
  scade_il       timestamptz,
  urgente        boolean not null default false,
  fatto_il       timestamptz,
  nota_id        uuid references public.note(id) on delete set null,
  creata_il      timestamptz not null default now(),
  modificata_il  timestamptz not null default now(),
  eliminata_il   timestamptz
);

create index promemoria_aperti_idx on public.promemoria (utente_id, scade_il)
  where fatto_il is null and eliminata_il is null;
create index promemoria_nota_idx on public.promemoria (nota_id);

create trigger promemoria_modificata before update on public.promemoria
  for each row execute function public.imposta_modificata_il();

-- ---------------------------------------------------------------
-- Allegati (foto delle note). File nel bucket privato "allegati",
-- percorso: <utente_id>/<nota_id>/<nome file>
-- ---------------------------------------------------------------
create table public.allegati (
  id         uuid primary key default gen_random_uuid(),
  utente_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nota_id    uuid not null references public.note(id) on delete cascade,
  percorso   text not null,
  tipo       text,
  creata_il  timestamptz not null default now()
);

create index allegati_nota_idx on public.allegati (nota_id);

insert into storage.buckets (id, name, public)
values ('allegati', 'allegati', false);

-- ---------------------------------------------------------------
-- Sicurezza: RLS ovunque, accesso solo all'utente proprietario.
-- Nessun accesso per anon.
-- ---------------------------------------------------------------
alter table public.aree          enable row level security;
alter table public.note          enable row level security;
alter table public.persone       enable row level security;
alter table public.persone_aree  enable row level security;
alter table public.note_persone  enable row level security;
alter table public.promemoria    enable row level security;
alter table public.allegati      enable row level security;

revoke all on public.aree, public.note, public.persone, public.persone_aree,
              public.note_persone, public.promemoria, public.allegati
  from anon;

grant select on public.aree to authenticated;
grant select, insert, update, delete on
  public.note, public.persone, public.persone_aree,
  public.note_persone, public.promemoria, public.allegati
  to authenticated;

create policy "aree leggibili" on public.aree
  for select to authenticated using (true);

create policy "solo proprietario" on public.note
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.persone
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.persone_aree
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.note_persone
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.promemoria
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.allegati
  for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));

create policy "allegati: solo la propria cartella" on storage.objects
  for all to authenticated
  using (bucket_id = 'allegati' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'allegati' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------
-- Cestino: ogni notte cancella ciò che è nel cestino da più di 30 giorni.
-- (I file delle foto nel bucket verranno puliti da una funzione dedicata.)
-- ---------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'svuota-cestino-30-giorni',
  '0 3 * * *',
  $$
    delete from public.note       where eliminata_il < now() - interval '30 days';
    delete from public.persone    where eliminata_il < now() - interval '30 days';
    delete from public.promemoria where eliminata_il < now() - interval '30 days';
  $$
);
