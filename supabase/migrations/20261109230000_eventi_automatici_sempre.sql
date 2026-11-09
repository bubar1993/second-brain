-- Eventi messi in calendario da soli: la prova (26.10–9.11.2026) resta accesa (Giovanni, 09.11.2026: "sì restano
-- accesi"). Tolta solo la data di scadenza da evento_automatico_ok; tutte le altre condizioni restano uguali.
-- Per spegnerla: rimettere in cima `select now() < timestamptz '<data passata>' and …`.
create or replace function public.evento_automatico_ok(p_ruolo text, p_proposto_da text, p_nota uuid, p_area text,
  p_inizio timestamptz, p_fine timestamptz, p_titolo text, p_luogo text, p_descrizione text, p_partecipanti text[],
  p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select ((p_ruolo = 'agente_lavoro' and p_proposto_da = 'lavoro' and p_area in ('C', 'G'))
      or (p_ruolo = 'agente_privato' and p_proposto_da = 'privato' and p_area = 'P'))
    and p_inizio > now() and p_inizio < now() + interval '60 days'
    and coalesce(cardinality(p_partecipanti), 0) = 0
    and concat_ws(' ', p_titolo, p_luogo, p_descrizione) !~* '(https?://|www\.|\.(com|ch|it|net|org|io|me)(/|\s|$))'
    and exists (select 1 from public.note n
                where n.id = p_nota and n.fonte in ('scritta', 'voce') and n.lavorata_il is null
                  and n.eliminata_il is null and n.creata_il > now() - interval '3 days'
                  and coalesce(n.area, p_area) = p_area and not coalesce(n.da_ceramex, false))
    and not exists (select 1 from public.eventi e
                    where e.id <> p_id and e.stato not in ('scartato', 'cancellato') and not e.tutto_il_giorno
                      and e.inizio < coalesce(p_fine, p_inizio + interval '1 hour') + interval '1 hour'
                      and coalesce(e.fine, e.inizio + interval '1 hour') > p_inizio - interval '1 hour')
$$;
-- Stessa firma: i permessi restano (solo agente_lavoro e agente_privato). Ripetuti per sicurezza.
revoke all on function public.evento_automatico_ok(text, text, uuid, text, timestamptz, timestamptz, text, text, text, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.evento_automatico_ok(text, text, uuid, text, timestamptz, timestamptz, text, text, text, text[], uuid)
  to agente_lavoro, agente_privato;
