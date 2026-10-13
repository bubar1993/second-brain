-- Second Brain GF – Quaderno Note (13.10.2026, ok di Giovanni sulla bozza grafica).
-- Ceramex e G&C usano le schede (aziende) e i cantieri che ci sono già. Il Privato ha capitoli scelti da Giovanni:
-- per persona (le note collegate a quella persona) e per tema (le note messe in quel tema). Si aggiungono e si tolgono.
create table public.quaderno_capitoli (
  id            uuid primary key default gen_random_uuid(),
  utente_id     uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  tipo          text not null check (tipo in ('persona', 'tema')),
  persona_id    uuid references public.persone(id) on delete cascade,
  nome          text,                                   -- per i temi (le persone hanno il loro nome)
  ordine        int not null default 0,
  creata_il     timestamptz not null default now(),
  eliminata_il  timestamptz,
  check ((tipo = 'persona' and persona_id is not null) or (tipo = 'tema' and nullif(btrim(nome), '') is not null))
);
create unique index quaderno_capitoli_persona on public.quaderno_capitoli (persona_id) where tipo = 'persona' and eliminata_il is null;

-- Note messe in un tema (una nota può stare in più temi).
create table public.note_temi (
  nota_id     uuid not null references public.note(id) on delete cascade,
  capitolo_id uuid not null references public.quaderno_capitoli(id) on delete cascade,
  utente_id   uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  creata_il   timestamptz not null default now(),
  primary key (nota_id, capitolo_id)
);
create index note_temi_capitolo on public.note_temi (capitolo_id);

alter table public.quaderno_capitoli enable row level security;
alter table public.note_temi enable row level security;
revoke all on public.quaderno_capitoli, public.note_temi from anon;
grant select, insert, update, delete on public.quaderno_capitoli, public.note_temi to authenticated;
create policy "solo proprietario" on public.quaderno_capitoli for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.note_temi for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));

-- Connettori (app Claude): solo lettura, come per le altre tabelle.
do $$
declare t text;
begin
  foreach t in array array['quaderno_capitoli', 'note_temi'] loop
    execute format('create policy "connettori solo lettura (ins)" on public.%I as restrictive for insert to authenticated with check ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (mod)" on public.%I as restrictive for update to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "connettori solo lettura (canc)" on public.%I as restrictive for delete to authenticated using ((auth.jwt() ->> ''client_id'') is null)', t);
  end loop;
end $$;

-- L'agente privato li vede e può mettere le note nei temi (niente cancellazioni); il capo vede tutto.
grant select, insert on public.quaderno_capitoli, public.note_temi to agente_privato;
create policy "agente privato" on public.quaderno_capitoli for all to agente_privato using (true) with check (true);
create policy "agente privato" on public.note_temi for all to agente_privato using (true) with check (true);
do $$
declare t text;
begin
  foreach t in array array['quaderno_capitoli', 'note_temi'] loop
    execute format('grant select, insert, update on public.%I to agente_capo', t);
    execute format('drop policy if exists "capo" on public.%I', t);
    execute format('create policy "capo" on public.%I for all to agente_capo using (true) with check (true)', t);
  end loop;
end $$;

-- Capitoli di partenza: i gemelli e tre temi (Giovanni li cambia dall'app).
insert into public.quaderno_capitoli (utente_id, tipo, persona_id, ordine)
  select p.utente_id, 'persona', p.id, row_number() over (order by p.nome)
  from public.persone p where p.eliminata_il is null and p.nome in ('Leonardo', 'Jolie')
    and exists (select 1 from public.persone_aree pa where pa.persona_id = p.id and pa.area = 'P');
insert into public.quaderno_capitoli (utente_id, tipo, nome, ordine)
  select u.id, 'tema', t.nome, t.ordine
  from (select id from auth.users order by created_at limit 1) u,
       (values ('Casa', 1), ('Auto', 2), ('Viaggi', 3)) t(nome, ordine);
