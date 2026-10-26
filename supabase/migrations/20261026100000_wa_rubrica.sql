-- WhatsApp ↔ Rubrica (26.10.2026, richiesta di Giovanni): ogni contatto WhatsApp prende dalla rubrica del telefono
-- (account Google giovannifabris@ceramex.ch, tabella rubrica) lo stesso numero → nome, area, scheda persona e,
-- se la persona ha una sola ditta C/G, la ditta. Riempie solo i campi vuoti: le scelte fatte a mano restano.
-- Lo storico WhatsApp non arriva (iscrizione di Meta ferma all'ultimo passo): i contatti nascono coi messaggi nuovi.

-- Il contatto della rubrica con quel numero (wa_id = solo cifre, come e164 senza +). Prima quello con la scheda,
-- poi lavoro prima del privato.
create or replace function public.wa_dalla_rubrica(numero text)
returns table (nome text, area text, persona_id uuid, azienda_id uuid)
language sql stable set search_path to ''
as $$
  select nullif(btrim(concat_ws(' ', r.nome, r.cognome)), ''), r.area, r.persona_id,
         (select min(pa.azienda_id::text)::uuid from public.persone_aziende pa join public.aziende a on a.id = pa.azienda_id
           where pa.persona_id = r.persona_id and a.area in ('C', 'G') and a.eliminata_il is null
           having count(*) = 1)
  from public.rubrica r
  where r.eliminata_il is null
    and exists (select 1 from jsonb_array_elements(r.telefoni) t
                where regexp_replace(coalesce(t->>'e164', t->>'valore', ''), '\D', '', 'g') = numero)
  order by (r.persona_id is null), (r.area = 'P'), r.aggiornata_il desc nulls last
  limit 1
$$;

-- Contatto nuovo (arriva dal webhook): si abbina subito.
create or replace function public.wa_contatti_abbina()
returns trigger language plpgsql set search_path to ''
as $$
declare r record;
begin
  select * into r from public.wa_dalla_rubrica(new.wa_id);
  if found then
    new.nome_rubrica := coalesce(new.nome_rubrica, r.nome);
    new.area := coalesce(new.area, r.area);
    new.persona_id := coalesce(new.persona_id, r.persona_id);
    new.azienda_id := coalesce(new.azienda_id, r.azienda_id);
  end if;
  return new;
end $$;
create trigger wa_contatti_abbina before insert on public.wa_contatti
  for each row execute function public.wa_contatti_abbina();

-- Contatti già presenti o rubrica cambiata dopo (contatto aggiunto sul telefono, scheda aperta): ogni 15 minuti.
create or replace function public.wa_abbina_rubrica()
returns integer language sql set search_path to ''
as $$
  with fatti as (
    update public.wa_contatti c set
      nome_rubrica = coalesce(c.nome_rubrica, r.nome),
      area = coalesce(c.area, r.area),
      persona_id = coalesce(c.persona_id, r.persona_id),
      azienda_id = coalesce(c.azienda_id, r.azienda_id)
    from public.wa_contatti c2
    cross join lateral public.wa_dalla_rubrica(c2.wa_id) r
    where c.wa_id = c2.wa_id
      and ((c.nome_rubrica is null and r.nome is not null) or (c.area is null and r.area is not null)
        or (c.persona_id is null and r.persona_id is not null) or (c.azienda_id is null and r.azienda_id is not null))
    returning 1
  )
  select count(*)::int from fatti
$$;

revoke all on function public.wa_dalla_rubrica(text), public.wa_abbina_rubrica() from public, anon, authenticated;
grant execute on function public.wa_dalla_rubrica(text), public.wa_abbina_rubrica() to service_role;

select cron.schedule('wa-abbina-rubrica', '7,22,37,52 * * * *', $$ select public.wa_abbina_rubrica() $$);

select public.wa_abbina_rubrica();
