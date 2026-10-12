-- Privato (fase 6): i gemelli Leonardo e Jolie (12.10.2026, dati dati da Giovanni).
-- Schermata "Gemelli" (#/gemelli): settimana, attività fisse con chi accompagna, feste dei compagni
-- (invito → risposta → regalo), diario (note collegate ai bambini). Niente moduli: le cose nuove le
-- scrive Giovanni col + e le mette a posto l'agente privato.

-- I bambini sono persone del Privato con ruolo figlio/figlia.
do $$
declare l uuid; j uuid;
begin
  insert into public.persone (utente_id, nome, ruolo, compleanno, fonte)
    values (public.utente_predefinito(), 'Leonardo', 'figlio', '2018-05-03', 'app') returning id into l;
  insert into public.persone (utente_id, nome, ruolo, compleanno, fonte)
    values (public.utente_predefinito(), 'Jolie', 'figlia', '2018-05-03', 'app') returning id into j;
  insert into public.persone_aree (persona_id, area) values (l, 'P'), (j, 'P');
end $$;

-- Attività fisse della settimana (giorno 1 = lunedì … 7 = domenica; null = orario ancora da sapere).
create table public.attivita_figli (
  id          uuid primary key default gen_random_uuid(),
  utente_id   uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  persone     uuid[] not null,               -- quali bambini
  nome        text not null,
  giorno      int check (giorno between 1 and 7),
  inizio      time,
  fine        time,
  luogo       text,
  accompagna  text,                          -- "Giovanni", "a piedi", "nonna"…
  note        text,
  attiva      boolean not null default true,
  creata_il   timestamptz not null default now(),
  modificata_il timestamptz not null default now()
);

-- Feste dei compagni: invito → risposta → regalo.
create table public.feste (
  id          uuid primary key default gen_random_uuid(),
  utente_id   uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  persone     uuid[] not null,               -- bambini invitati
  festeggiato text not null,
  inizio      timestamptz,
  fine        timestamptz,
  luogo       text,
  risposta    text check (risposta in ('da_dare','si','no')) default 'da_dare',
  regalo      text check (regalo in ('da_prendere','preso','non_serve')) default 'da_prendere',
  idea_regalo text,
  evento_id   uuid references public.eventi(id) on delete set null,
  nota_id     uuid references public.note(id) on delete set null,
  creata_il   timestamptz not null default now(),
  modificata_il timestamptz not null default now()
);
create unique index feste_evento on public.feste (evento_id) where evento_id is not null;

alter table public.attivita_figli enable row level security;
alter table public.feste enable row level security;
revoke all on public.attivita_figli, public.feste from anon;
grant select, insert, update, delete on public.attivita_figli, public.feste to authenticated;
create policy "solo proprietario" on public.attivita_figli for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.feste for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
-- L'agente privato le tiene aggiornate (niente cancellazioni).
grant select, insert, update on public.attivita_figli, public.feste to agente_privato;
create policy "agente privato" on public.attivita_figli for all to agente_privato using (true) with check (true);
create policy "agente privato" on public.feste for all to agente_privato using (true) with check (true);
-- Connettori (app Claude): solo lettura, come per le altre tabelle.
create policy "connettori solo lettura (ins)" on public.attivita_figli as restrictive for insert to authenticated with check ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (mod)" on public.attivita_figli as restrictive for update to authenticated using ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (canc)" on public.attivita_figli as restrictive for delete to authenticated using ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (ins)" on public.feste as restrictive for insert to authenticated with check ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (mod)" on public.feste as restrictive for update to authenticated using ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (canc)" on public.feste as restrictive for delete to authenticated using ((auth.jwt() ->> 'client_id') is null);

-- Quello che Giovanni ha detto il 12.10.2026.
insert into public.attivita_figli (persone, nome, giorno, inizio, fine, accompagna)
select array[l.id, j.id], 'Pianoforte', 2, '16:30', '18:00', 'Giovanni o a piedi'
from public.persone l, public.persone j where l.nome = 'Leonardo' and l.ruolo = 'figlio' and j.nome = 'Jolie' and j.ruolo = 'figlia';
insert into public.attivita_figli (persone, nome, accompagna)
select array[p.id], x.nome, 'Giovanni o a piedi'
from public.persone p join (values ('Leonardo','Calcio'), ('Leonardo','Tennis'), ('Jolie','Gymnastique'), ('Jolie','Atletica'), ('Jolie','Fashion design')) x(chi, nome)
  on p.nome = x.chi and p.ruolo in ('figlio','figlia');

insert into public.domande (utente_id, area, agente, testo) values
  (public.utente_predefinito(), 'P', 'privato',
   'Gemelli: che giorni e a che ora fanno calcio e tennis (Leonardo), Gymnastique, atletica e Fashion design (Jolie)? Scrivi per esempio «Calcio lunedì e giovedì 17-18:30». In calendario vedo «Atletica 13.15-14.45» il mercoledì: è di Jolie?');
