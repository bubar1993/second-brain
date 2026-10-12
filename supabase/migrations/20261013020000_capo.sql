-- Agente capo (13.10.2026 notte, ok di Giovanni): l'agente a cui Giovanni scrive o detta dall'app (tasto "Capo"
-- in basso, accanto a Chiedi). Ha pieni poteri su Ceramex, G&C e Privato nel second brain, può passare lavori
-- agli altri agenti (richieste_agenti, da = 'capo') e farli partire (funzione agente-subito).
-- Le cose rischiose (mandare mail o messaggi, cancellare, scrivere nei gestionali, spostare mail) le propone in
-- capo_conferme: le fa solo dopo i due tocchi di Giovanni nell'app. Le modifiche alle app (Brain, Ceramex, G&C)
-- le scrive in modifiche_claude: le fa Claude Code sul PC, solo con l'ok di Giovanni.
-- Utente del database "agente_capo": legge e scrive tutte le tabelle (tranne wa_collegamento, che ha il token
-- di Meta), mai cancellazioni vere (il cestino è eliminata_il). Per le tabelle nuove: rilanciare il blocco "capo
-- vede tutto" qui sotto.
create role agente_capo nologin noinherit;
grant usage on schema public to agente_capo;
grant usage on all sequences in schema public to agente_capo;
grant execute on function public.utente_predefinito() to agente_capo;
grant execute on function public.cerca(text, text, integer) to agente_capo;
grant execute on function public.aree_persona(uuid) to agente_capo;

-- Richieste: il capo scrive agli agenti e riceve quelle di Giovanni.
alter table public.richieste_agenti drop constraint if exists richieste_agenti_agente_check;
alter table public.richieste_agenti add constraint richieste_agenti_agente_check
  check (agente in ('lavoro', 'ceramex', 'gc', 'calendario', 'privato', 'archiviazione', 'smistatore', 'seguire', 'capo'));
alter table public.richieste_agenti drop constraint if exists richieste_agenti_da_check;
alter table public.richieste_agenti add constraint richieste_agenti_da_check check (da in ('giovanni', 'smistatore', 'capo'));

-- Cose rischiose da confermare con due tocchi nell'app.
create table public.capo_conferme (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  richiesta_id uuid references public.richieste_agenti(id) on delete set null,   -- la richiesta di Giovanni da cui nasce
  area text check (area in ('C', 'G', 'P')),
  tipo text not null check (tipo in ('mail', 'messaggio', 'cancella', 'gestionale', 'sposta_mail', 'altro')),
  cosa text not null check (length(trim(cosa)) > 0),   -- cosa farà, in parole semplici: lo legge Giovanni
  dettagli text,                                        -- il testo esatto (mail, messaggio, dati da scrivere)
  stato text not null default 'da_confermare' check (stato in ('da_confermare', 'confermata', 'rifiutata', 'fatta', 'non_fatta')),
  creata_il timestamptz not null default now(),
  confermata_il timestamptz,
  rifiutata_il timestamptz,
  fatta_il timestamptz,
  esito text
);
create index on public.capo_conferme (stato, creata_il desc);

-- Modifiche alle app che il capo non può fare: le fa Claude Code sul PC, con l'ok di Giovanni.
create table public.modifiche_claude (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  richiesta_id uuid references public.richieste_agenti(id) on delete set null,
  app text not null check (app in ('brain', 'ceramex', 'gc')),
  titolo text not null check (length(trim(titolo)) > 0),
  testo text not null check (length(trim(testo)) > 0),   -- cosa cambiare e perché, con gli esempi di Giovanni
  stato text not null default 'proposta' check (stato in ('proposta', 'ok', 'fatta', 'scartata')),
  creata_il timestamptz not null default now(),
  ok_il timestamptz,
  fatta_il timestamptz,
  scartata_il timestamptz,
  nota_claude text                                       -- cosa ha fatto Claude Code
);
create index on public.modifiche_claude (stato, creata_il desc);

alter table public.capo_conferme enable row level security;
alter table public.modifiche_claude enable row level security;
create policy "solo proprietario" on public.capo_conferme for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.modifiche_claude for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
grant select, insert, update, delete on public.capo_conferme, public.modifiche_claude to authenticated;

-- Il capo propone e poi segna fatto/non fatto; confermare o rifiutare può solo Giovanni.
grant select on public.capo_conferme, public.modifiche_claude to agente_capo;
grant insert (richiesta_id, area, tipo, cosa, dettagli) on public.capo_conferme to agente_capo;
grant update (stato, fatta_il, esito) on public.capo_conferme to agente_capo;
grant insert (richiesta_id, app, titolo, testo) on public.modifiche_claude to agente_capo;
create policy "capo" on public.capo_conferme for all to agente_capo using (true) with check (true);
create policy "capo" on public.modifiche_claude for all to agente_capo using (true) with check (true);

create or replace function public.capo_conferme_controllo() returns trigger language plpgsql as $$
begin
  if current_user = 'agente_capo' then
    if new.stato is distinct from old.stato and new.stato not in ('fatta', 'non_fatta') then
      raise exception 'Confermare o rifiutare lo fa solo Giovanni dall''app';
    end if;
    if new.stato = 'fatta' and old.confermata_il is null then
      raise exception 'Giovanni non l''ha confermata: non si può fare';
    end if;
  end if;
  return new;
end $$;
create trigger capo_conferme_controllo before update on public.capo_conferme
  for each row execute function public.capo_conferme_controllo();

-- Capo vede tutto: ogni tabella con RLS (tranne wa_collegamento e le due sue qui sopra), leggere e scrivere, niente delete.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
             and c.relname not in ('wa_collegamento', 'capo_conferme', 'modifiche_claude') loop
    execute format('grant select, insert, update on public.%I to agente_capo', t.relname);
    execute format('drop policy if exists "capo" on public.%I', t.relname);
    execute format('create policy "capo" on public.%I for all to agente_capo using (true) with check (true)', t.relname);
  end loop;
end $$;

-- Connettori solo lettura anche sulle tabelle nuove (vedi 20261012110000_mcp_solo_lettura.sql).
do $$
declare t text;
begin
  foreach t in array array['capo_conferme', 'modifiche_claude'] loop
    execute format('create policy "connettori solo lettura (ins)" on public.%I as restrictive for insert to authenticated with check ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (mod)" on public.%I as restrictive for update to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (canc)" on public.%I as restrictive for delete to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
  end loop;
end $$;
