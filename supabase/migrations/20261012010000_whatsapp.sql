-- Second Brain GF – Fase 7: WhatsApp Business (ok di Giovanni, 12.10.2026 sera).
-- Numero dell'app WhatsApp Business di Giovanni collegato alla piattaforma ufficiale Meta
-- in "coesistenza": il telefono continua a funzionare, i messaggi arrivano anche qui
-- (funzione "whatsapp": webhook di Meta). Da qui si può anche scrivere (funzione "invia-whatsapp").
-- Storico: Meta manda una sola volta gli ultimi 6 mesi (chat singole, niente gruppi).

-- ---------------------------------------------------------------
-- Collegamento (uno solo). Il token di Meta lo vede solo il server (nessun permesso all'app).
-- ---------------------------------------------------------------
create table public.wa_collegamento (
  id               smallint primary key default 1 check (id = 1),
  waba_id          text,
  phone_number_id  text,
  numero           text,
  token            text,
  collegato_il     timestamptz,
  contatti_chiesti_il timestamptz,
  storico_chiesto_il  timestamptz,
  ultimo_webhook_il   timestamptz,
  errore           text
);
alter table public.wa_collegamento enable row level security;
revoke all on public.wa_collegamento from anon, authenticated;

-- Stato leggibile dall'app (senza token).
create view public.wa_stato with (security_invoker = false) as
  select waba_id is not null and token is not null as collegato, numero, collegato_il,
         contatti_chiesti_il, storico_chiesto_il, ultimo_webhook_il, errore
  from public.wa_collegamento;
revoke all on public.wa_stato from anon;
grant select on public.wa_stato to authenticated;

-- ---------------------------------------------------------------
-- Contatti WhatsApp (wa_id = numero internazionale senza +).
-- area: dove va di solito quel contatto (C, G, P); null = da capire.
-- approfondita: per le persone di cui Giovanni vuole tenere molto di più (es. la fidanzata).
-- ---------------------------------------------------------------
create table public.wa_contatti (
  wa_id            text primary key,
  utente_id        uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  nome_profilo     text,
  nome_rubrica     text,
  area             text references public.aree(codice),
  azienda_id       uuid references public.aziende(id) on delete set null,
  persona_id       uuid references public.persone(id) on delete set null,
  approfondita     boolean not null default false,
  ultimo_in_il     timestamptz,
  ultimo_il        timestamptz,
  note             text,
  creata_il        timestamptz not null default now(),
  modificata_il    timestamptz not null default now()
);
create trigger wa_contatti_modificata before update on public.wa_contatti
  for each row execute function public.imposta_modificata_il();

-- ---------------------------------------------------------------
-- Messaggi. direzione: in (ricevuto) | out (mandato da Giovanni, dal telefono o dall'app).
-- fonte: webhook (arrivato ora) | eco (scritto dal telefono) | storico (import 6 mesi) | app (scritto dall'app).
-- ---------------------------------------------------------------
create table public.wa_messaggi (
  id               text primary key,            -- id del messaggio di WhatsApp (wamid…)
  utente_id        uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  wa_id            text not null references public.wa_contatti(wa_id) on update cascade,
  direzione        text not null check (direzione in ('in','out')),
  fonte            text not null check (fonte in ('webhook','eco','storico','app')),
  tipo             text not null default 'text',
  testo            text,
  media            jsonb,
  risponde_a       text,
  data             timestamptz not null,
  stato            text,                        -- per i messaggi mandati: sent, delivered, read, failed
  errore           text,
  grezzo           jsonb,
  -- lavoro dell'agente
  area             text references public.aree(codice),
  vista_il         timestamptz,
  esito            text check (esito in ('nota','niente','da_capire')),
  motivo           text,
  creata_il        timestamptz not null default now()
);
create index wa_messaggi_chat_idx on public.wa_messaggi (wa_id, data desc);
create index wa_messaggi_da_vedere_idx on public.wa_messaggi (data) where vista_il is null;
create index wa_messaggi_testo_idx on public.wa_messaggi using gin (to_tsvector('simple', coalesce(testo,'')));

-- Bozze anche per WhatsApp (stessa schermata Bozze dell'app).
alter table public.bozze add column canale text not null default 'mail' check (canale in ('mail','whatsapp'));
alter table public.bozze add column wa_id text references public.wa_contatti(wa_id) on update cascade;

-- Note nate da WhatsApp.
alter table public.note drop constraint if exists note_fonte_check;
alter table public.note add constraint note_fonte_check
  check (fonte in ('scritta','voce','foto','condivisa','mail','whatsapp'));
alter table public.note add column wa_messaggio_id text references public.wa_messaggi(id) on delete set null;

-- Ultimo messaggio per contatto (per l'elenco chat).
create or replace function public.wa_aggiorna_contatto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.wa_contatti set
    ultimo_il = greatest(coalesce(ultimo_il, new.data), new.data),
    ultimo_in_il = case when new.direzione = 'in' then greatest(coalesce(ultimo_in_il, new.data), new.data) else ultimo_in_il end
  where wa_id = new.wa_id;
  return new;
end $$;
create trigger wa_messaggi_contatto after insert on public.wa_messaggi
  for each row execute function public.wa_aggiorna_contatto();

-- ---------------------------------------------------------------
-- Sicurezza app: solo Giovanni.
-- ---------------------------------------------------------------
alter table public.wa_contatti enable row level security;
alter table public.wa_messaggi enable row level security;
revoke all on public.wa_contatti, public.wa_messaggi from anon;
grant select, insert, update on public.wa_contatti, public.wa_messaggi to authenticated;
create policy "solo proprietario" on public.wa_contatti for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.wa_messaggi for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
