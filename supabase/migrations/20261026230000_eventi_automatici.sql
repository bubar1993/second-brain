-- Eventi messi in calendario da soli (26.10.2026, ok di Giovanni: "eventi ok, testiamo come va", "solo dalle mie
-- note"). Prova di 2 settimane, fino al 9.11.2026 compreso: poi si spegne da sola (data in evento_automatico_ok).
-- Piano controllato dall'antagonista (26.10.2026):
-- - gli agenti inseriscono sempre 'proposto' (le loro policy lo vogliono); il cambio in 'da_creare' lo fa un
--   trigger AFTER INSERT del database, mai l'agente;
-- - vale solo per l'agente lavoro e l'agente privato, riconosciuti dal ruolo del database (non da proposto_da,
--   che l'agente scrive da sé: il Capo potrebbe fingersi un altro);
-- - solo da una nota di Giovanni (scritta o dettata) creata da meno di 3 giorni e che l'agente sta lavorando adesso
--   (lavorata_il vuoto), senza link nel titolo, nel luogo o nella descrizione, senza invitati, nei prossimi 60 giorni
--   e se non c'è già un altro appuntamento nella stessa ora (±1 ora, qualsiasi area);
-- - tutto il resto (mail, WhatsApp, inviti a call, Capo, agenti Ceramex e G&C) resta una proposta con Sì/No.
-- Niente tasto "Togli": un evento che non va lo cancella Giovanni da Google Calendar e la copia lo segna 'cancellato'.

alter table public.eventi add column if not exists automatico boolean not null default false;

-- Si può mettere in calendario da solo? (security definer: guarda note ed eventi di tutte le aree, risponde solo sì/no)
create or replace function public.evento_automatico_ok(p_ruolo text, p_proposto_da text, p_nota uuid, p_area text,
  p_inizio timestamptz, p_fine timestamptz, p_titolo text, p_luogo text, p_descrizione text, p_partecipanti text[],
  p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select now() < timestamptz '2026-11-10 00:00 Europe/Zurich'
    and ((p_ruolo = 'agente_lavoro' and p_proposto_da = 'lavoro' and p_area in ('C', 'G'))
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
revoke all on function public.evento_automatico_ok(text, text, uuid, text, timestamptz, timestamptz, text, text, text, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.evento_automatico_ok(text, text, uuid, text, timestamptz, timestamptz, text, text, text, text[], uuid)
  to agente_lavoro, agente_privato;

-- BEFORE INSERT (gira col ruolo di chi scrive): automatico lo decide sempre il database, mai chi inserisce.
create or replace function public.eventi_automatico_prima() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.automatico := false;
  -- IF e non AND: gli altri ruoli (app, agente calendario, Capo…) non possono chiamare evento_automatico_ok.
  if new.stato = 'proposto' and current_user in ('agente_lavoro', 'agente_privato') then
    new.automatico := coalesce(public.evento_automatico_ok(current_user::text, new.proposto_da, new.nota_id, new.area,
      new.inizio, new.fine, new.titolo, new.luogo, new.descrizione, new.partecipanti, new.id), false);
  end if;
  return new;
end $$;
create trigger eventi_automatico_prima before insert on public.eventi
  for each row execute function public.eventi_automatico_prima();

-- AFTER INSERT (security definer): solo ora lo stato diventa 'da_creare', dopo i controlli delle policy.
create or replace function public.eventi_automatico_dopo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.automatico and new.stato = 'proposto' then
    update public.eventi set stato = 'da_creare' where id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.eventi_automatico_dopo() from public, anon, authenticated;
create trigger eventi_automatico_dopo after insert on public.eventi
  for each row execute function public.eventi_automatico_dopo();

-- Nessuno lo cambia dopo (il Capo e l'agente calendario possono aggiornare tutte le colonne).
create or replace function public.eventi_automatico_fisso() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.automatico := old.automatico;
  return new;
end $$;
create trigger eventi_automatico_fisso before update of automatico on public.eventi
  for each row execute function public.eventi_automatico_fisso();
