-- Second Brain GF – ricerca per significato (13.10.2026, ok di Giovanni: "se gratuita procediamo").
-- Ogni nota, mail G&C, scheda persona e messaggio WhatsApp ha un "vettore" (il suo significato in numeri),
-- calcolato gratis dal modello multilingue bge-m3 di Cloudflare Workers AI (Worker dell'app, /api/vettori).
-- Chiedi cerca le cose con il significato più vicino alla domanda, anche senza le stesse parole.
create extension if not exists vector with schema extensions;

create table public.vettori (
  tipo          text not null check (tipo in ('nota', 'mail', 'persona', 'whatsapp')),
  rif           text not null,                 -- id della cosa (persona: persona_id:area)
  impronta      text not null,                 -- md5 del testo: se cambia, il vettore si rifà
  vettore       extensions.vector(1024) not null,
  aggiornato_il timestamptz not null default now(),
  primary key (tipo, rif)
);
alter table public.vettori enable row level security;
revoke all on public.vettori from anon, authenticated;

-- Quanto testo si manda al giorno (per restare sempre dentro la parte gratuita di Cloudflare).
create table public.vettori_uso (
  giorno    date primary key,
  caratteri bigint not null default 0
);
alter table public.vettori_uso enable row level security;
revoke all on public.vettori_uso from anon, authenticated;

-- Il testo di ogni cosa, come lo legge il modello (con la ditta, il mandante, la persona).
create or replace function public.testi_significato()
returns table (tipo text, rif text, testo text)
language sql stable set search_path to ''
as $$
  select 'nota', n.id::text,
         left(concat_ws('. ', a.nome, n.mandante, n.contatto, n.testo), 3000)
  from public.note n left join public.aziende a on a.id = n.azienda_id
  where n.eliminata_il is null and n.scartata_il is null and coalesce(btrim(n.testo), '') <> ''
  union all
  select 'mail', p.id::text,
         left(concat_ws('. ', p.da_nome, p.oggetto, p.testo), 2000)
  from public.posta p
  where coalesce(btrim(p.testo), '') <> '' or coalesce(btrim(p.oggetto), '') <> ''
  union all
  select 'persona', r.persona_id::text || ':' || r.area,
         left(concat_ws('. ', concat_ws(' ', pe.nome, pe.cognome), r.chi_e, r.ultimo_incontro, r.cose_aperte, r.da_chiedere, r.consigli), 3000)
  from public.persone_riassunti r join public.persone pe on pe.id = r.persona_id
  where pe.eliminata_il is null
  union all
  select 'whatsapp', m.id::text,
         left(concat_ws('. ', coalesce(nullif(c.nome_rubrica, ''), c.nome_profilo), m.testo), 2000)
  from public.wa_messaggi m join public.wa_contatti c on c.wa_id = m.wa_id
  where coalesce(btrim(m.testo), '') <> ''
$$;

-- Le cose senza vettore o con il testo cambiato (prima le più recenti, così si trovano subito).
create or replace function public.vettori_da_fare(quanti int default 50)
returns table (tipo text, rif text, testo text, impronta text)
language sql stable set search_path to ''
as $$
  select t.tipo, t.rif, t.testo, md5(t.testo)
  from public.testi_significato() t
  left join public.vettori v on v.tipo = t.tipo and v.rif = t.rif
  where v.rif is null or v.impronta <> md5(t.testo)
  order by case t.tipo when 'nota' then 0 when 'persona' then 1 when 'whatsapp' then 2 else 3 end, t.rif desc
  limit quanti
$$;

-- Le cose più vicine per significato alla domanda (q = vettore della domanda), nel formato di cerca().
create or replace function public.cerca_significato(q extensions.vector(1024), area_scelta text default null, quanti int default 15, minimo real default 0.45)
returns table (tipo text, id text, area text, titolo text, estratto text, data timestamptz, collegamento text, punti real)
language sql stable set search_path to ''
as $$
  with vicini as (
    select v.tipo, v.rif, (1 - (v.vettore operator(extensions.<=>) q))::real as somiglianza
    from public.vettori v
  ), cose as (
    select 'nota'::text as tipo, n.id::text as id, n.area, coalesce(a.nome, 'Nota') as titolo, n.testo as corpo,
           coalesce(n.data::timestamptz, n.creata_il) as data, '#/nota/' || n.id as collegamento, x.somiglianza
    from vicini x join public.note n on x.tipo = 'nota' and n.id::text = x.rif
    left join public.aziende a on a.id = n.azienda_id
    where n.eliminata_il is null and n.scartata_il is null
    union all
    select 'mail', p.id::text, p.area, coalesce(nullif(p.oggetto, ''), '(senza oggetto)'), p.testo, p.data,
           '#/mail/' || replace(replace(p.message_id, '<', '%3C'), '>', '%3E'), x.somiglianza
    from vicini x join public.posta p on x.tipo = 'mail' and p.id::text = x.rif
    union all
    select 'persona', r.persona_id::text, r.area, concat_ws(' ', pe.nome, pe.cognome),
           concat_ws(' · ', r.chi_e, r.cose_aperte, r.da_chiedere, r.ultimo_incontro), r.aggiornato_il,
           '#/persona/' || r.persona_id, x.somiglianza
    from vicini x join public.persone_riassunti r on x.tipo = 'persona' and r.persona_id::text || ':' || r.area = x.rif
    join public.persone pe on pe.id = r.persona_id
    where pe.eliminata_il is null
    union all
    select 'whatsapp', m.id::text, c.area, coalesce(nullif(c.nome_rubrica, ''), c.nome_profilo, '+' || c.wa_id), m.testo, m.data,
           case when c.persona_id is not null then '#/persona/' || c.persona_id else '#/whatsapp/' || c.wa_id end, x.somiglianza
    from vicini x join public.wa_messaggi m on x.tipo = 'whatsapp' and m.id::text = x.rif
    join public.wa_contatti c on c.wa_id = m.wa_id
  )
  select tipo, id, area, titolo, left(coalesce(corpo, ''), 260), data, collegamento, somiglianza
  from cose
  where (area_scelta is null or area = area_scelta) and somiglianza >= minimo
  order by somiglianza desc
  limit quanti
$$;

-- Solo la funzione "significato" (service_role) le usa.
revoke all on function public.testi_significato() from public, anon, authenticated;
revoke all on function public.vettori_da_fare(int) from public, anon, authenticated;
revoke all on function public.cerca_significato(extensions.vector, text, int, real) from public, anon, authenticated;
grant execute on function public.testi_significato() to service_role;
grant execute on function public.vettori_da_fare(int) to service_role;
grant execute on function public.cerca_significato(extensions.vector, text, int, real) to service_role;
grant select, insert, update, delete on public.vettori, public.vettori_uso to service_role;

-- Ogni 10 minuti i vettori delle cose nuove o cambiate (stesso token della copia).
select cron.schedule('significato', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/significato',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{"azione":"indicizza"}'::jsonb,
    timeout_milliseconds := 120000)
$$);
