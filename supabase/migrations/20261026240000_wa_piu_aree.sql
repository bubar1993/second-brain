-- WhatsApp in più aree (26.10.2026, ok di Giovanni, piano controllato dall'antagonista).
-- Le aree di una chat = l'area scelta nella chat (wa_contatti.area) PIÙ le aree della scheda della persona collegata.
-- Regola Lavoro/Privato: se tra queste c'è il Privato, per gli agenti la chat è SOLO privata (l'agente lavoro non la
-- vede; prima vedeva anche le chat senza area con la scheda privata). Nell'app e in Chiedi la chat compare in ogni area.
-- Il 26.10 nessuna chat aveva un'area diversa da quella della sua scheda: nessuna chat cambia agente oggi.

create or replace function public.aree_contatto_wa(w text) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.area order by x.area), '{}')
  from (select c.area from public.wa_contatti c where c.wa_id = w and c.area is not null
        union
        select pa.area from public.wa_contatti c join public.persone_aree pa on pa.persona_id = c.persona_id
        where c.wa_id = w) x
$$;
revoke all on function public.aree_contatto_wa(text) from public, anon;
grant execute on function public.aree_contatto_wa(text) to authenticated, service_role, agente_lavoro, agente_privato,
  agente_capo, agente_smistatore, agente_calendario, agente_ceramex, agente_gc, agente_seguire;

-- Agente lavoro: le chat senza Privato (comprese quelle da smistare).
drop policy "agente lavoro" on public.wa_contatti;
drop policy "agente lavoro smista" on public.wa_contatti;
drop policy "agente lavoro" on public.wa_messaggi;
drop policy "agente lavoro smista" on public.wa_messaggi;
create policy "agente lavoro" on public.wa_contatti for select to agente_lavoro
  using (not ('P' = any(public.aree_contatto_wa(wa_id))));
create policy "agente lavoro smista" on public.wa_contatti for update to agente_lavoro
  using (not ('P' = any(public.aree_contatto_wa(wa_id)))) with check (area in ('C','G','P') or area is null);
create policy "agente lavoro" on public.wa_messaggi for select to agente_lavoro
  using (not ('P' = any(public.aree_contatto_wa(wa_id))));
create policy "agente lavoro smista" on public.wa_messaggi for update to agente_lavoro
  using (not ('P' = any(public.aree_contatto_wa(wa_id))));

-- Agente privato: le chat con il Privato, anche se hanno pure un'area di lavoro.
drop policy "agente privato" on public.wa_contatti;
drop policy "agente privato cambia" on public.wa_contatti;
drop policy "agente privato" on public.wa_messaggi;
drop policy "agente privato cambia" on public.wa_messaggi;
create policy "agente privato" on public.wa_contatti for select to agente_privato
  using ('P' = any(public.aree_contatto_wa(wa_id)));
create policy "agente privato cambia" on public.wa_contatti for update to agente_privato
  using ('P' = any(public.aree_contatto_wa(wa_id))) with check (area = 'P' or 'P' = any(public.aree_contatto_wa(wa_id)));
create policy "agente privato" on public.wa_messaggi for select to agente_privato
  using ('P' = any(public.aree_contatto_wa(wa_id)));
create policy "agente privato cambia" on public.wa_messaggi for update to agente_privato
  using ('P' = any(public.aree_contatto_wa(wa_id)));

-- Chiedi (ricerca per parole): con un'area scelta, i messaggi WhatsApp escono in ogni area della chat.
create or replace function public.cerca(q text, area_scelta text default null, quanti integer default 40)
returns table(tipo text, id text, area text, titolo text, estratto text, data timestamptz, collegamento text, punti real)
language sql stable set search_path to '' as $function$
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
    select 'whatsapp', m.id, coalesce(area_scelta, c.area), coalesce(nullif(c.nome_rubrica, ''), c.nome_profilo, '+' || c.wa_id), m.testo, m.data,
           case when c.persona_id is not null then '#/persona/' || c.persona_id else '#/whatsapp/' || c.wa_id end,
           to_tsvector('italian', concat_ws(' ', c.nome_rubrica, c.nome_profilo, m.testo)), 0.8
    from public.wa_messaggi m join public.wa_contatti c on c.wa_id = m.wa_id cross join qq
    where qq.tq is not null and to_tsvector('italian', coalesce(m.testo, '')) @@ qq.tq
      and (area_scelta is null or c.area = area_scelta
           or exists (select 1 from public.persone_aree pa where pa.persona_id = c.persona_id and pa.area = area_scelta))
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
$function$;

-- Chiedi (ricerca per significato): stessa regola.
create or replace function public.cerca_significato(q extensions.vector, area_scelta text default null, quanti integer default 15,
  minimo real default 0.45)
returns table(tipo text, id text, area text, titolo text, estratto text, data timestamptz, collegamento text, punti real)
language sql stable set search_path to '' as $function$
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
    select 'whatsapp', m.id::text,
           case when area_scelta is not null and exists (select 1 from public.persone_aree pa
                  where pa.persona_id = c.persona_id and pa.area = area_scelta) then area_scelta else c.area end,
           coalesce(nullif(c.nome_rubrica, ''), c.nome_profilo, '+' || c.wa_id), m.testo, m.data,
           case when c.persona_id is not null then '#/persona/' || c.persona_id else '#/whatsapp/' || c.wa_id end, x.somiglianza
    from vicini x join public.wa_messaggi m on x.tipo = 'whatsapp' and m.id::text = x.rif
    join public.wa_contatti c on c.wa_id = m.wa_id
  )
  select tipo, id, area, titolo, left(coalesce(corpo, ''), 260), data, collegamento, somiglianza
  from cose
  where (area_scelta is null or area = area_scelta) and somiglianza >= minimo
  order by somiglianza desc
  limit quanti
$function$;
