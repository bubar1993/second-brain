-- Second Brain GF – Schede persona (richiesta di Giovanni, 12.10.2026).
-- Ogni persona ha la sua scheda: chi è, ditte, contatti, note, mail, WhatsApp e un riassunto
-- scritto dagli agenti (uno per area: il lavoro non vede il Privato e viceversa).
-- Le persone nascono dai contatti delle schede aziende (Ceramex e G&C) e si collegano da sole
-- alle note che le nominano ("contatto"). Poi le aggiungono Giovanni e gli agenti.

-- ---------------------------------------------------------------
-- Persone: campi in più.
-- ---------------------------------------------------------------
alter table public.persone add column ruolo text;
alter table public.persone add column email_altre text[] not null default '{}';
alter table public.persone add column fonte text not null default 'app' check (fonte in ('app','scheda','agente','whatsapp'));
alter table public.persone add column chiave text unique;   -- per la copia dai contatti delle schede
alter table public.persone alter column utente_id set default public.utente_predefinito();
alter table public.persone_aree alter column utente_id set default public.utente_predefinito();
alter table public.note_persone alter column utente_id set default public.utente_predefinito();
alter table public.promemoria alter column utente_id set default public.utente_predefinito();

-- Persona ↔ ditta (una persona può stare in più ditte, anche di aree diverse).
create table public.persone_aziende (
  persona_id  uuid not null references public.persone(id) on delete cascade,
  azienda_id  uuid not null references public.aziende(id) on delete cascade,
  ruolo       text,
  utente_id   uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  primary key (persona_id, azienda_id)
);
create index persone_aziende_azienda_idx on public.persone_aziende (azienda_id);

-- Riassunto della persona, uno per area (lo scrive l'agente di quell'area).
create table public.persone_riassunti (
  persona_id       uuid not null references public.persone(id) on delete cascade,
  area             text not null references public.aree(codice),
  utente_id        uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  chi_e            text,     -- chi è, che ruolo ha, come lo conosce Giovanni
  ultimo_incontro  text,     -- ultimo contatto/incontro e di cosa si è parlato
  cose_aperte      text,     -- promesse, problemi, cose da fare con lei/lui
  da_chiedere      text,     -- cosa chiedere la prossima volta ("com'è andato il colloquio?")
  consigli         text,     -- come parlarle/scriverle (tono, lingua, cosa evitare)
  aggiornato_il    timestamptz not null default now(),
  primary key (persona_id, area)
);

-- Domande degli agenti per Giovanni (dubbi: si risponde dall'app).
create table public.domande (
  id           uuid primary key default gen_random_uuid(),
  utente_id    uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  area         text references public.aree(codice),
  agente       text not null,
  testo        text not null,
  scelte       text[],        -- risposte pronte (un tocco)
  nota_id      uuid references public.note(id) on delete cascade,
  persona_id   uuid references public.persone(id) on delete cascade,
  azienda_id   uuid references public.aziende(id) on delete cascade,
  risposta     text,
  risposta_il  timestamptz,
  chiusa_il    timestamptz,   -- l'agente ha usato la risposta
  creata_il    timestamptz not null default now()
);
create index domande_aperte_idx on public.domande (creata_il) where risposta_il is null;

-- Note scritte nell'app: quando l'agente le ha già lavorate.
alter table public.note add column lavorata_il timestamptz;

-- ---------------------------------------------------------------
-- Sicurezza app: solo Giovanni.
-- ---------------------------------------------------------------
alter table public.persone_aziende enable row level security;
alter table public.persone_riassunti enable row level security;
alter table public.domande enable row level security;
revoke all on public.persone_aziende, public.persone_riassunti, public.domande from anon;
grant select, insert, update, delete on public.persone_aziende, public.persone_riassunti to authenticated;
grant select, update on public.domande to authenticated;
create policy "solo proprietario" on public.persone_aziende for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.persone_riassunti for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.domande for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- Copia dei contatti delle schede in "persone" + collegamento delle note che le nominano.
-- Non cancella e non sovrascrive niente: riempie solo i campi vuoti.
-- ---------------------------------------------------------------
create or replace function public.sincronizza_persone() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := public.utente_predefinito();
  r record;
  pid uuid;
  nuove int := 0;
  collegate int := 0;
  wa int := 0;
begin
  for r in
    select a.id as azienda_id, a.area, regexp_replace(trim(c->>'nome'), '\s+', ' ', 'g') as nome,
           nullif(lower(trim(c->>'email')), '') as email,
           nullif(trim(coalesce(c->>'telefono', c->>'tel')), '') as telefono,
           nullif(trim(c->>'ruolo'), '') as ruolo
    from public.aziende a
    cross join lateral jsonb_array_elements(case when jsonb_typeof(a.contatti) = 'array' then a.contatti else '[]'::jsonb end) c
    where a.eliminata_il is null and a.unito_in is null and coalesce(trim(c->>'nome'), '') <> ''
  loop
    pid := null;
    -- 1. già collegata a questa ditta con lo stesso nome
    select p.id into pid from public.persone p
      join public.persone_aziende pa on pa.persona_id = p.id and pa.azienda_id = r.azienda_id
      where p.eliminata_il is null and lower(concat_ws(' ', p.nome, p.cognome)) = lower(r.nome) limit 1;
    -- 2. stessa mail e stesso nome di battesimo (le mail tipo info@ le usano in tanti)
    if pid is null and r.email is not null then
      select p.id into pid from public.persone p
        where p.eliminata_il is null and (lower(p.email) = r.email or r.email = any(p.email_altre))
          and lower(p.nome) = lower(split_part(r.nome, ' ', 1)) limit 1;
    end if;
    -- 3. già copiata prima
    if pid is null then
      select p.id into pid from public.persone p where p.chiave = 'scheda:' || r.azienda_id || ':' || lower(r.nome);
    end if;

    if pid is null then
      insert into public.persone (utente_id, nome, cognome, email, telefono, ruolo, fonte, chiave)
      values (u, split_part(r.nome, ' ', 1), nullif(substr(r.nome, length(split_part(r.nome, ' ', 1)) + 2), ''),
              r.email, r.telefono, r.ruolo, 'scheda', 'scheda:' || r.azienda_id || ':' || lower(r.nome))
      returning id into pid;
      nuove := nuove + 1;
    else
      update public.persone p set
        email = coalesce(p.email, r.email),
        email_altre = case when r.email is not null and p.email is not null and lower(p.email) <> r.email
                            and not (r.email = any(p.email_altre)) then p.email_altre || r.email else p.email_altre end,
        telefono = coalesce(p.telefono, r.telefono),
        ruolo = coalesce(p.ruolo, r.ruolo)
      where p.id = pid;
    end if;
    insert into public.persone_aziende (persona_id, azienda_id, ruolo, utente_id) values (pid, r.azienda_id, r.ruolo, u)
      on conflict (persona_id, azienda_id) do update set ruolo = coalesce(public.persone_aziende.ruolo, excluded.ruolo);
    insert into public.persone_aree (persona_id, area, utente_id) values (pid, r.area, u) on conflict do nothing;
  end loop;

  -- Note con "contatto" (es. "Emiliana") → la persona di quella ditta (o del suo gruppo) con quel nome.
  -- Solo se il nome porta a UNA persona sola, e solo per le note senza persone collegate.
  with nomi as (
    select n.id as nota_id, n.area, coalesce(az.gruppo_id, az.id) as radice, lower(trim(x)) as nome
    from public.note n
    join public.aziende az on az.id = n.azienda_id
    cross join lateral regexp_split_to_table(n.contatto, '\s*(,|/|;|\se\s)\s*') x
    where n.contatto is not null and n.eliminata_il is null and trim(x) <> ''
      and not exists (select 1 from public.note_persone np where np.nota_id = n.id)
  ), candidati as (
    select distinct nm.nota_id, nm.nome, pa.persona_id
    from nomi nm
    join public.aziende az2 on coalesce(az2.gruppo_id, az2.id) = nm.radice
    join public.persone_aziende pa on pa.azienda_id = az2.id
    join public.persone p on p.id = pa.persona_id and p.eliminata_il is null
    where nm.nome in (lower(p.nome), lower(concat_ws(' ', p.nome, p.cognome)), lower(coalesce(p.cognome, '')))
  ), unici as (
    select nota_id, nome, min(persona_id::text)::uuid as persona_id from candidati group by nota_id, nome having count(*) = 1
  ), fatte as (
    insert into public.note_persone (nota_id, persona_id, utente_id)
    select distinct nota_id, persona_id, u from unici
    on conflict do nothing
    returning 1
  )
  select count(*) into collegate from fatte;

  -- Contatti WhatsApp → persona con lo stesso numero.
  with fatte as (
    update public.wa_contatti w set persona_id = p.id
    from public.persone p
    where w.persona_id is null and p.eliminata_il is null and p.telefono is not null
      and w.wa_id = public.numero_internazionale(p.telefono)
    returning 1
  )
  select count(*) into wa from fatte;

  return jsonb_build_object('nuove', nuove, 'note_collegate', collegate, 'whatsapp', wa);
end $$;

-- "+41 79 123 45 67", "079 123 45 67", "0041…" → "41791234567" (come i numeri di WhatsApp).
create or replace function public.numero_internazionale(t text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d like '00%' then substr(d, 3)
    when d like '0%' then '41' || substr(d, 2)
    else d end
  from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) x
$$;

revoke all on function public.sincronizza_persone() from public, anon, authenticated;

-- Ogni 15 minuti (dopo le copie da Ceramex e G&C).
select cron.schedule('sincronizza-persone', '7,22,37,52 * * * *', $$ select public.sincronizza_persone() $$);
