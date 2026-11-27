-- Ricerca piu' veloce (27.11.2026, ok di Giovanni, antagonista).
-- Prima cerca() ricalcolava to_tsvector sul testo intero di ogni mail e di ogni nota trovata, solo per dare il punteggio:
-- 0,9 secondi su 1,4 per le mail e 0,26 per le note ("listino marazzi", 983 mail e 2513 note trovate).
-- Ora l'elenco delle parole sta gia' pronto in una colonna calcolata dal database (generated: si aggiorna da sola).
-- Il filtro delle mail resta sull'indice di prima (posta_testo_it_idx): cambia solo da dove si prende il punteggio.

-- Aggiungere la colonna riscrive la tabella e la blocca per qualche secondo. Se qualcuno la sta leggendo a lungo
-- l'ALTER aspetterebbe in coda bloccando tutti gli altri: meglio rinunciare dopo 5 secondi e riprovare (tutto o niente).
set lock_timeout = '5s';

alter table public.posta add column if not exists tsv tsvector
  generated always as (to_tsvector('italian', coalesce(oggetto, '') || ' ' || coalesce(testo, ''))) stored;
alter table public.note add column if not exists tsv tsvector
  generated always as (to_tsvector('italian', coalesce(testo, '') || ' ' || coalesce(contatto, '') || ' ' || coalesce(mandante, ''))) stored;
comment on column public.posta.tsv is 'Parole di oggetto e testo per la ricerca (calcolata dal database, non si scrive). Non serve leggerla.';
comment on column public.note.tsv is 'Parole di testo, contatto e mandante per la ricerca (calcolata dal database, non si scrive). Non serve leggerla.';

CREATE OR REPLACE FUNCTION public.cerca(q text, area_scelta text DEFAULT NULL::text, quanti integer DEFAULT 40)
 RETURNS TABLE(tipo text, id text, area text, titolo text, estratto text, data timestamp with time zone, collegamento text, punti real)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with qq as (select public.domanda_in_query(q) as tq,
                     (select jsonb_object_agg(p, peso) from public.pesi_domanda(q)) as pesi),
  trovati as (
    select 'nota'::text as tipo, n.id::text as id, n.area, coalesce(a.nome, 'Nota') as titolo, n.testo as corpo,
           coalesce(n.data::timestamptz, n.creata_il) as data, '#/nota/' || n.id as collegamento,
           (n.tsv || to_tsvector('italian', coalesce(a.nome, ''))) as v, 1.0 as peso
    from public.note n cross join qq left join public.aziende a on a.id = n.azienda_id
    where qq.tq is not null and n.eliminata_il is null and n.scartata_il is null
      and (n.tsv || to_tsvector('italian', coalesce(a.nome, ''))) @@ qq.tq
      and (area_scelta is null or n.area = area_scelta)
    union all
    select 'mail', p.id::text, p.area, coalesce(nullif(p.oggetto, ''), '(senza oggetto)'), p.testo, p.data,
           '#/mail/' || replace(replace(p.message_id, '<', '%3C'), '>', '%3E'),
           (to_tsvector('italian', coalesce(p.da_nome, '')) || p.tsv), 0.5
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

-- Il backup non porta le colonne calcolate (si rifanno da sole e raddoppierebbero il peso di posta).
create or replace function public.backup_export_pezzo(p_tabella text, p_da integer, p_quanti integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  righe jsonb;
begin
  if not exists (select 1 from pg_catalog.pg_tables where schemaname = 'public' and tablename = p_tabella) then
    raise exception 'Tabella sconosciuta: %', p_tabella;
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - ''token'' - ''tsv''), ''[]''::jsonb) from (select * from public.%I order by ctid offset %s limit %s) t',
    p_tabella, greatest(p_da, 0), least(greatest(p_quanti, 1), 2000)
  ) into righe;
  return righe;
end;
$function$;

reset lock_timeout;
