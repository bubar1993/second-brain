-- Second Brain GF – Calendario (fase 3), 12.10.2026 notte.
-- Gli appuntamenti di Google Calendar (giovannifabris@ceramex.ch) si copiano qui ogni ora con una routine
-- claude.ai che usa il connettore Google Calendar dell'account di Giovanni (gratis, niente chiavi Google nuove).
-- Gli agenti possono PROPORRE appuntamenti trovati in note, mail e WhatsApp: Giovanni li approva nell'app
-- con un tocco, poi la routine li crea in Google Calendar (all'inizio sempre con la sua conferma).

create table public.eventi (
  id               uuid primary key default gen_random_uuid(),
  utente_id        uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  google_id        text unique,                -- id dell'evento in Google Calendar
  calendario       text not null default 'giovannifabris@ceramex.ch',
  area             text references public.aree(codice),
  titolo           text not null,
  inizio           timestamptz not null,
  fine             timestamptz,
  tutto_il_giorno  boolean not null default false,
  luogo            text,
  descrizione      text,
  partecipanti     text[] not null default '{}',
  azienda_id       uuid references public.aziende(id) on delete set null,
  persona_id       uuid references public.persone(id) on delete set null,
  stato            text not null default 'confermato'
                   check (stato in ('confermato','proposto','da_creare','scartato','cancellato')),
  proposto_da      text,                       -- agente che l'ha proposto
  nota_id          uuid references public.note(id) on delete set null,   -- da dove viene la proposta
  motivo           text,                       -- perché l'agente lo propone
  errore           text,
  creata_il        timestamptz not null default now(),
  modificata_il    timestamptz not null default now()
);
create index eventi_inizio_idx on public.eventi (inizio) where stato in ('confermato','proposto','da_creare');
create trigger eventi_modificata before update on public.eventi for each row execute function public.imposta_modificata_il();

alter table public.eventi enable row level security;
revoke all on public.eventi from anon;
grant select, insert, update on public.eventi to authenticated;
create policy "solo proprietario" on public.eventi for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));

-- Gli agenti delle note propongono appuntamenti nella loro area.
grant select, insert on public.eventi to agente_lavoro, agente_privato;
create policy "agente lavoro" on public.eventi for select to agente_lavoro using (area in ('C','G'));
create policy "agente lavoro propone" on public.eventi for insert to agente_lavoro with check (area in ('C','G') and stato = 'proposto');
create policy "agente privato" on public.eventi for select to agente_privato using (area = 'P');
create policy "agente privato propone" on public.eventi for insert to agente_privato with check (area = 'P' and stato = 'proposto');

-- Agente calendario: copia gli eventi e crea quelli approvati. Vede solo eventi e i NOMI di ditte e persone
-- (per collegare l'appuntamento alla scheda giusta), niente note.
create role agente_calendario nologin noinherit;
grant usage on schema public to agente_calendario;
grant select, insert, update on public.eventi to agente_calendario;
grant select (id, nome, area, ragione_sociale, domini, email, unito_in, eliminata_il) on public.aziende to agente_calendario;
grant select (id, nome, cognome, email, eliminata_il) on public.persone to agente_calendario;
grant select on public.persone_aziende, public.aree to agente_calendario;
grant insert on public.lavori_registro to agente_calendario;
grant usage on sequence public.lavori_registro_id_seq to agente_calendario;
grant execute on function public.utente_predefinito() to agente_calendario;
create policy "agente calendario" on public.eventi for all to agente_calendario using (true) with check (true);
create policy "agente calendario" on public.aziende for select to agente_calendario using (true);
create policy "agente calendario" on public.persone for select to agente_calendario using (true);
create policy "agente calendario" on public.persone_aziende for select to agente_calendario using (true);
create policy "agente calendario" on public.lavori_registro for insert to agente_calendario with check (lavoro = 'agente-calendario');
