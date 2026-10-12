-- Second Brain GF – Chiedi: ricerca gratuita in italiano (12.10.2026 notte, ok di Giovanni: "partiamo gratis").
-- Cerca in note, mail G&C, riassunti delle persone e WhatsApp. Capisce le forme delle parole
-- ("piastrella" trova "piastrelle"), ignora le parole vuote ("cosa mi ha detto…") e mette prima
-- quello che contiene PIÙ parole della domanda (anche nel nome del cliente o della persona),
-- poi le note prima delle mail e le cose recenti. Gira con i permessi di chi chiede (RLS).

create index if not exists note_testo_it_idx on public.note using gin (to_tsvector('italian', coalesce(testo, '')));
create index if not exists posta_testo_it_idx on public.posta using gin (to_tsvector('italian', coalesce(oggetto, '') || ' ' || coalesce(testo, '')));
create index if not exists wa_messaggi_testo_it_idx on public.wa_messaggi using gin (to_tsvector('italian', coalesce(testo, '')));

-- Le parole utili della domanda (radici italiane), senza parole vuote e senza le parole delle domande
-- ("cosa", "detto", "quando"…). Le radici lunghe valgono anche come inizio di parola.
create or replace function public.parole_domanda(q text) returns setof text
language sql stable set search_path = '' as $$
  select case when length(l) >= 6 then quote_literal(l) || ':*' else quote_literal(l) end
  from unnest(tsvector_to_array(to_tsvector('italian', coalesce(q, '')))) l
  where l not in ('cos', 'dett', 'dir', 'dic', 'dett', 'qual', 'quand', 'com', 'chi', 'dov', 'perc', 'sap',
                  'cerc', 'trov', 'mostr', 'dim', 'parl', 'detto', 'scritt', 'scriv')
$$;

-- La domanda diventa "parola1 | parola2 | …".
create or replace function public.domanda_in_query(q text) returns tsquery
language sql stable set search_path = '' as $$
  select case when count(*) = 0 then null else to_tsquery('italian', string_agg(p, ' | ')) end
  from public.parole_domanda(q) p
$$;

-- Peso delle parole della domanda: i nomi di ditte e persone valgono 4, le altre 1.
create or replace function public.pesi_domanda(q text) returns table (p text, peso real)
language sql stable set search_path = '' as $$
  select x.p, case when exists (select 1 from public.aziende a where a.eliminata_il is null
                     and to_tsvector('italian', concat_ws(' ', a.nome, a.ragione_sociale)) @@ to_tsquery('italian', x.p))
                   or exists (select 1 from public.persone pe where pe.eliminata_il is null
                     and to_tsvector('italian', concat_ws(' ', pe.nome, pe.cognome)) @@ to_tsquery('italian', x.p))
              then 4 else 1 end::real
  from public.parole_domanda(q) x(p)
$$;

-- Quanto della domanda c'è in un testo (somma dei pesi delle parole trovate).
create or replace function public.parole_trovate(v tsvector, pesi jsonb) returns real
language sql immutable set search_path = '' as $$
  select coalesce(sum((e.value)::real), 0) from jsonb_each_text(pesi) e where v @@ to_tsquery('italian', e.key)
$$;

drop function if exists public.cerca(text, text, int);
create or replace function public.cerca(q text, area_scelta text default null, quanti int default 40)
returns table (tipo text, id text, area text, titolo text, estratto text, data timestamptz, collegamento text, punti real)
language sql stable security invoker set search_path = '' as $$
  with qq as (select public.domanda_in_query(q) as tq,
                     (select jsonb_object_agg(p, peso) from public.pesi_domanda(q)) as pesi),
  trovati as (
    select 'nota'::text as tipo, n.id::text as id, n.area, coalesce(a.nome, 'Nota') as titolo, n.testo as corpo,
           coalesce(n.data::timestamptz, n.creata_il) as data, '#/nota/' || n.id as collegamento,
           to_tsvector('italian', concat_ws(' ', n.testo, n.contatto, a.nome, n.mandante)) as v, 1.0 as peso
    from public.note n cross join qq left join public.aziende a on a.id = n.azienda_id
    where qq.tq is not null and n.eliminata_il is null and n.scartata_il is null
      and to_tsvector('italian', concat_ws(' ', n.testo, n.contatto, a.nome, n.mandante)) @@ qq.tq
      and (area_scelta is null or n.area = area_scelta)
    union all
    select 'mail', p.id::text, p.area, coalesce(nullif(p.oggetto, ''), '(senza oggetto)'), p.testo, p.data,
           '#/mail/' || replace(replace(p.message_id, '<', '%3C'), '>', '%3E'),
           to_tsvector('italian', concat_ws(' ', p.da_nome, p.oggetto, p.testo)), 0.5
    from public.posta p cross join qq
    where qq.tq is not null
      and to_tsvector('italian', coalesce(p.oggetto, '') || ' ' || coalesce(p.testo, '')) @@ qq.tq
      and (area_scelta is null or p.area = area_scelta)
    union all
    select 'persona', r.persona_id::text, r.area, concat_ws(' ', pe.nome, pe.cognome),
           concat_ws(' · ', r.chi_e, r.cose_aperte, r.da_chiedere, r.ultimo_incontro), r.aggiornato_il,
           '#/persona/' || r.persona_id,
           to_tsvector('italian', concat_ws(' ', pe.nome, pe.cognome, r.chi_e, r.ultimo_incontro, r.cose_aperte, r.da_chiedere)), 1.2
    from public.persone_riassunti r join public.persone pe on pe.id = r.persona_id cross join qq
    where qq.tq is not null and pe.eliminata_il is null
      and to_tsvector('italian', concat_ws(' ', pe.nome, pe.cognome, r.chi_e, r.ultimo_incontro, r.cose_aperte, r.da_chiedere)) @@ qq.tq
      and (area_scelta is null or r.area = area_scelta)
    union all
    select 'whatsapp', m.id, c.area, coalesce(nullif(c.nome_rubrica, ''), c.nome_profilo, '+' || c.wa_id), m.testo, m.data,
           case when c.persona_id is not null then '#/persona/' || c.persona_id else '#/whatsapp/' || c.wa_id end,
           to_tsvector('italian', concat_ws(' ', c.nome_rubrica, c.nome_profilo, m.testo)), 0.8
    from public.wa_messaggi m join public.wa_contatti c on c.wa_id = m.wa_id cross join qq
    where qq.tq is not null and to_tsvector('italian', coalesce(m.testo, '')) @@ qq.tq
      and (area_scelta is null or c.area = area_scelta)
  ),
  con_punti as (
    select t.*, (public.parole_trovate(t.v, (select pesi from qq)) * 10 + ts_rank_cd(t.v, (select tq from qq), 32) * 5)
           * t.peso * (1 + 0.5 / (1 + extract(epoch from now() - coalesce(t.data, now())) / 86400 / 90)) as punti
    from trovati t
  ),
  migliori as (select * from con_punti order by punti desc limit quanti)
  select m.tipo, m.id, m.area, m.titolo,
         ts_headline('italian', left(coalesce(m.corpo, ''), 4000), qq.tq,
           'MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … ", StartSel=«, StopSel=»'),
         m.data, m.collegamento, m.punti::real
  from migliori m cross join qq
  order by m.punti desc
$$;

revoke all on function public.cerca(text, text, int) from anon;
grant execute on function public.cerca(text, text, int) to authenticated;
drop function if exists public.parole_trovate(tsvector, text);
grant execute on function public.parole_domanda(text), public.domanda_in_query(text), public.pesi_domanda(text),
  public.parole_trovate(tsvector, jsonb) to authenticated;
