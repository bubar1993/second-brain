-- Second Brain GF – Rubrica (13.10.2026, ok di Giovanni).
-- Copia dei contatti Google di giovannifabris@ceramex.ch (quelli che ha sul telefono), nei due sensi:
-- la funzione `rubrica` legge da Google ogni 15 minuti e scrive in Google quello che Giovanni cambia nell'app.
-- Scelte di Giovanni:
--   - un contatto che è già una persona del brain (stessa mail, stesso numero o stesso nome) si collega a lei
--     e riempie solo i campi vuoti;
--   - un contatto palesemente di un cliente (ditta o "(Ditta)" nel nome, dominio della mail) diventa una persona
--     di quella ditta;
--   - tutti gli altri vanno nel Privato SENZA scheda persona e senza note: la scheda si apre solo quando serve;
--   - le persone di lavoro con mail o telefono che sul telefono non ci sono si aggiungono in Google come
--     "Nome Cognome (Ditta)".
-- Eliminare dall'app = eliminare da Google (e dal telefono); qui resta una copia per "Ripristina".

create table public.rubrica (
  id             uuid primary key default gen_random_uuid(),
  utente_id      uuid not null default public.utente_predefinito() references auth.users(id) on delete cascade,
  risorsa        text unique,                     -- "people/c123…" in Google
  etag           text,
  nome           text,                            -- come in Google (il cognome può finire con "(Ditta)")
  cognome        text,
  ditta          text,                            -- organizzazione in Google
  ruolo          text,
  telefoni       jsonb not null default '[]',     -- [{ valore, tipo, e164 }]
  email          jsonb not null default '[]',     -- [{ valore, tipo }]
  compleanno     date,                            -- anno 1904 = senza anno
  appunti        text,                            -- "note" del contatto in Google
  persona_id     uuid references public.persone(id) on delete set null,
  area           text check (area in ('C', 'G', 'P')),
  origine        text not null default 'telefono' check (origine in ('telefono', 'brain')),
  esaminata_il   timestamptz,                     -- abbinamento alla ditta già tentato (non si rifà)
  aggiornata_il  timestamptz not null default now(),
  creata_il      timestamptz not null default now(),
  eliminata_il   timestamptz,
  copia          jsonb                            -- il contatto com'era, per ripristinarlo
);
create index rubrica_persona on public.rubrica (persona_id);
create index rubrica_attivi on public.rubrica (utente_id) where eliminata_il is null;

-- Stato della lettura da Google (una riga).
create table public.rubrica_stato (
  utente_id        uuid primary key default public.utente_predefinito() references auth.users(id) on delete cascade,
  sync_token       text,
  ultimo_giro      timestamptz,
  esito            jsonb,
  aggiungi_lavoro  boolean not null default false  -- acceso dopo il primo controllo di Claude
);

alter table public.rubrica enable row level security;
alter table public.rubrica_stato enable row level security;
revoke all on public.rubrica, public.rubrica_stato from anon;
grant select, insert, update, delete on public.rubrica to authenticated;
grant select on public.rubrica_stato to authenticated;
create policy "solo proprietario" on public.rubrica for all to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy "solo proprietario" on public.rubrica_stato for select to authenticated using (utente_id = (select auth.uid()));
create policy "connettori solo lettura (ins)" on public.rubrica as restrictive for insert to authenticated with check ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (mod)" on public.rubrica as restrictive for update to authenticated using ((auth.jwt() ->> 'client_id') is null);
create policy "connettori solo lettura (canc)" on public.rubrica as restrictive for delete to authenticated using ((auth.jwt() ->> 'client_id') is null);

-- L'agente privato legge la rubrica (numeri, compleanni); il capo vede tutto. Gli agenti di lavoro no (c'è il Privato).
grant select on public.rubrica to agente_privato;
create policy "agente privato" on public.rubrica for select to agente_privato using (true);
grant select, update on public.rubrica to agente_capo;
create policy "capo" on public.rubrica for all to agente_capo using (true) with check (true);

-- Le persone nate dalla rubrica.
alter table public.persone drop constraint persone_fonte_check;
alter table public.persone add constraint persone_fonte_check check (fonte = any (array['app', 'scheda', 'agente', 'whatsapp', 'rubrica']));

-- "Rossi (Somazzi)" → "Rossi"
create or replace function public.senza_ditta(t text) returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(t, ''), '\s*\([^)]*\)\s*$', '')), '')
$$;

-- Abbina i contatti alle persone e alle ditte. La chiama la funzione rubrica dopo ogni lettura.
create or replace function public.rubrica_abbina() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := public.utente_predefinito();
  collegate int := 0;
  nuove int := 0;
  r record;
  c record;
  nuova uuid;
  v_nome text;
  v_cognome text;
begin
  -- 1. Persona già nel brain: stesso numero, stessa mail (le info@ solo con lo stesso nome di battesimo: le usano in tanti)
  --    o stesso nome e cognome. Solo se porta a UNA persona.
  for r in
    with liberi as (
      select x.* from public.rubrica x where x.persona_id is null and x.eliminata_il is null and x.utente_id = u
    ), cand as (
      select l.id as rid, p.id as pid
      from liberi l cross join lateral jsonb_array_elements(l.telefoni) t
      join public.persone p on p.eliminata_il is null and p.telefono is not null
        and length(public.numero_internazionale(p.telefono)) >= 8
        and public.numero_internazionale(p.telefono) = public.numero_internazionale(coalesce(t->>'e164', t->>'valore'))
      union
      select l.id, p.id
      from liberi l cross join lateral jsonb_array_elements(l.email) e
      join public.persone p on p.eliminata_il is null
        and (lower(p.email) = lower(e->>'valore') or lower(e->>'valore') = any (select lower(z) from unnest(p.email_altre) z))
        and (lower(p.nome) = lower(split_part(btrim(l.nome), ' ', 1))
             or split_part(lower(e->>'valore'), '@', 1) !~ '^(info|office|contact|kontakt|mail|admin|buero|bureau|ufficio|ordini|order|orders|verkauf|vente|sales|amministrazione|segreteria)')
      union
      select l.id, p.id
      from liberi l
      join public.persone p on p.eliminata_il is null and p.cognome is not null
        and lower(concat_ws(' ', p.nome, p.cognome)) = lower(concat_ws(' ', btrim(l.nome), public.senza_ditta(l.cognome)))
    ), unici as (
      select rid, min(pid::text)::uuid as pid from cand group by rid having count(distinct pid) = 1
    )
    -- Lo stesso contatto salvato due volte sul telefono porta alla stessa persona: si collegano tutti e due.
    select un.rid, un.pid from unici un
  loop
    update public.rubrica set persona_id = r.pid,
      area = coalesce((select pa.area from public.persone_aree pa where pa.persona_id = r.pid order by pa.area = 'P', pa.area limit 1), 'P')
    where id = r.rid;
    -- Solo i campi vuoti della persona.
    update public.persone p set
      telefono = coalesce(p.telefono, (select t->>'valore' from public.rubrica x, jsonb_array_elements(x.telefoni) t where x.id = r.rid limit 1)),
      email = coalesce(p.email, (select lower(e->>'valore') from public.rubrica x, jsonb_array_elements(x.email) e where x.id = r.rid limit 1)),
      compleanno = coalesce(p.compleanno, (select x.compleanno from public.rubrica x where x.id = r.rid))
    where p.id = r.pid;
    collegate := collegate + 1;
  end loop;

  -- 2. Contatti nuovi palesemente di una ditta Ceramex o G&C: "(Ditta)" nel nome, l'organizzazione,
  --    o il dominio della mail (non quelli gratuiti). Diventano persone di quella ditta. Una volta sola per contatto.
  for r in
    with nuovi as (
      select x.* from public.rubrica x
      where x.persona_id is null and x.eliminata_il is null and x.esaminata_il is null and x.utente_id = u
    ), nomi as (
      select n.id as rid, lower(btrim(v)) as nome
      from nuovi n cross join lateral (values (n.ditta), (substring(n.cognome from '\(([^)]+)\)\s*$')), (substring(n.nome from '\(([^)]+)\)\s*$'))) w(v)
      where nullif(btrim(v), '') is not null
    ), cand as (
      select nm.rid, a.id as aid, a.area as aarea from nomi nm
      join public.aziende a on a.eliminata_il is null and a.unito_in is null and a.area in ('C', 'G')
        and lower(a.nome) not in ('g&c', 'ceramex')   -- "(G&C)" sul telefono = contatto G&C, non il parcheggio
        and (lower(a.nome) = nm.nome or lower(a.ragione_sociale) = nm.nome)
      union
      select n.id, a.id, a.area from nuovi n cross join lateral jsonb_array_elements(n.email) e
      join public.aziende a on a.eliminata_il is null and a.unito_in is null and a.area in ('C', 'G')
        and lower(split_part(e->>'valore', '@', 2)) = any (select lower(d) from unnest(a.domini) d)
      where lower(split_part(e->>'valore', '@', 2)) not in ('gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'outlook.com',
        'live.com', 'yahoo.com', 'yahoo.it', 'icloud.com', 'me.com', 'bluewin.ch', 'gmx.ch', 'gmx.net', 'sunrise.ch', 'ticino.com', 'libero.it', 'hispeed.ch')
    )
    -- Stessa ditta in Ceramex e in G&C (es. Crea Ceram): vale quella Ceramex.
    select rid, coalesce(case when count(distinct aid) = 1 then min(aid::text) end, min(aid::text) filter (where aarea = 'C'))::uuid as aid
    from cand group by rid
    having count(distinct aid) = 1 or (count(distinct aid) = 2 and count(distinct aid) filter (where aarea = 'C') = 1)
    order by rid
  loop
    select x.*, a.nome as ditta_nome, a.area as ditta_area into c
      from public.rubrica x, public.aziende a where x.id = r.rid and a.id = r.aid;
    -- Nome sul telefono scritto di corsa: "Martin Gotthard | Volketswil", "JOHO | Ming", "Simon. 8149 | ATEGA".
    v_nome := btrim(regexp_replace(regexp_replace(coalesce(c.nome, ''), '\s*\([^)]*\)\s*$', ''), '[0-9.]+', '', 'g'));
    v_cognome := btrim(regexp_replace(coalesce(public.senza_ditta(c.cognome), ''), '[0-9.]+', '', 'g'));
    if position(' ' in v_nome) > 0 then
      v_cognome := substr(v_nome, position(' ' in v_nome) + 1);
      v_nome := split_part(v_nome, ' ', 1);
    end if;
    if length(v_nome) >= 4 and position(lower(left(v_nome, 4)) in lower(c.ditta_nome)) = 1 then
      v_nome := v_cognome; v_cognome := '';
    end if;
    if length(v_cognome) >= 4 and position(lower(left(v_cognome, 4)) in lower(c.ditta_nome)) = 1 then v_cognome := ''; end if;
    v_nome := coalesce(nullif(v_nome, ''), nullif(v_cognome, ''), 'Senza nome');
    v_cognome := case when nullif(v_cognome, '') = v_nome then null else nullif(v_cognome, '') end;

    -- C'è già nella ditta (stessa mail o stesso nome, anche da un doppione appena creato)? Allora si collega quella.
    nuova := null;
    select p.id into nuova from public.persone p
      join public.persone_aziende pa on pa.persona_id = p.id and pa.azienda_id = r.aid
      where p.eliminata_il is null and (
        lower(p.email) in (select lower(e->>'valore') from jsonb_array_elements(c.email) e)
        or lower(concat_ws(' ', p.nome, p.cognome)) = lower(concat_ws(' ', v_nome, v_cognome)))
      limit 1;
    if nuova is null then
      insert into public.persone (utente_id, nome, cognome, telefono, email, compleanno, fonte, chiave)
      values (u, v_nome, v_cognome,
        (select t->>'valore' from jsonb_array_elements(c.telefoni) t limit 1),
        (select lower(e->>'valore') from jsonb_array_elements(c.email) e limit 1),
        c.compleanno, 'rubrica', 'rubrica:' || c.risorsa)
      on conflict (chiave) do nothing
      returning id into nuova;
      if nuova is not null then nuove := nuove + 1; end if;
    else
      collegate := collegate + 1;
    end if;
    if nuova is not null then
      insert into public.persone_aziende (persona_id, azienda_id, ruolo, utente_id)
        select nuova, r.aid, x.ruolo, u from public.rubrica x where x.id = r.rid on conflict do nothing;
      insert into public.persone_aree (persona_id, area, utente_id)
        select nuova, a.area, u from public.aziende a where a.id = r.aid on conflict do nothing;
      update public.rubrica set persona_id = nuova, area = c.ditta_area where id = r.rid;
    end if;
  end loop;

  -- 3. Tutti gli altri: Privato, senza scheda.
  update public.rubrica set area = 'P' where area is null and persona_id is null and utente_id = u;
  update public.rubrica set esaminata_il = now() where esaminata_il is null and utente_id = u;

  return jsonb_build_object('collegate', collegate, 'persone_nuove', nuove);
end $$;
revoke all on function public.rubrica_abbina() from public, anon, authenticated;
grant execute on function public.rubrica_abbina() to service_role;

-- Lettura da Google ogni 15 minuti (stesso token delle altre copie).
select cron.schedule('rubrica', '3,18,33,48 * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/rubrica',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{"azione":"sincronizza"}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
