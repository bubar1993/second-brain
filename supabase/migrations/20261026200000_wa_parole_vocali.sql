-- Note vocali WhatsApp: i nomi che Whisper deve conoscere per scriverli giusti (26.10.2026, scelta di Giovanni).
-- Per ogni vocale: aziende e persone dell'area del contatto (le più recenti), un elenco fisso, la ditta e il nome
-- di chi scrive. Whisper tiene solo la fine del suggerimento (circa 220 pezzi di parola): le cose più importanti
-- vanno in fondo. La lingua la riconosce Whisper da solo (ogni tanto arrivano vocali in altre lingue).
-- La chiama solo whatsapp-vocali (service_role).
create or replace function public.wa_parole_vocale(p_id text)
returns text
language sql
stable
set search_path = public
as $$
  with v as (
    select c.area, c.persona_id,
           coalesce(nullif(trim(p.nome || ' ' || coalesce(p.cognome, '')), ''), c.nome_rubrica, c.nome_profilo) as nome
    from wa_messaggi m
    join wa_contatti c on c.wa_id = m.wa_id
    left join persone p on p.id = c.persona_id
    where m.id = p_id
  )
  select 'Nomi: ' || concat_ws(', ',
    (select string_agg(x, ', ') from (
       select a.nome as x from aziende a
       where a.eliminata_il is null and a.unito_in is null and a.area = v.area and v.area in ('C', 'G')
       order by a.modificata_il desc limit 25) s),
    (select string_agg(x, ', ') from (
       select trim(pe.nome || ' ' || coalesce(pe.cognome, '')) as x from persone pe
       join persone_aree pa on pa.persona_id = pe.id
       where pa.area = v.area and pe.eliminata_il is null
       order by pe.modificata_il desc limit 20) s),
    'Ceramex, G&C Home Concepts, Marazzi, Ragno, Flaviker, ABK, Garbelotto, Profilitec, Manno, Lugano, Ticino, Dafalgan, Algifor, Ponstan',
    (select string_agg(a.nome, ', ') from persone_aziende pz join aziende a on a.id = pz.azienda_id where pz.persona_id = v.persona_id),
    v.nome) || '.'
  from v;
$$;

revoke all on function public.wa_parole_vocale(text) from public, anon, authenticated;
grant execute on function public.wa_parole_vocale(text) to service_role;
