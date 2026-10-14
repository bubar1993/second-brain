-- 14.10.2026 (richiesta di Giovanni passata dal Capo, ok di Giovanni): quando una mail invita a una call
-- (Teams, Zoom, Meet) gli agenti G&C e Ceramex PROPONGONO l'appuntamento con data, ora e link per entrare.
-- La mail si archivia come sempre (Riordino) e non si prepara nessuna risposta.

-- La parte calendario della mail (text/calendar, .ics), letta da posta-gc: data e ora degli inviti Teams stanno lì.
-- { metodo, titolo, inizio, fine, tutto_il_giorno, luogo, link, organizzatore, uid, fuso }
alter table public.posta add column if not exists invito jsonb;

-- Da quale mail viene la proposta (posta.message_id per info@, id del messaggio Gmail per Ceramex):
-- una sola proposta per mail, anche se due giri dell'agente la vedono insieme.
alter table public.eventi add column if not exists da_mail text;
create unique index if not exists eventi_da_mail_idx on public.eventi (da_mail);

-- Gli agenti propongono solo nella loro area e solo come 'proposto' (Giovanni dice Sì/No in Oggi).
grant select, insert on public.eventi to agente_gc, agente_ceramex;
drop policy if exists "agente gc" on public.eventi;
drop policy if exists "agente gc propone" on public.eventi;
drop policy if exists "agente ceramex" on public.eventi;
drop policy if exists "agente ceramex propone" on public.eventi;
create policy "agente gc" on public.eventi for select to agente_gc using (area = 'G');
create policy "agente gc propone" on public.eventi for insert to agente_gc with check (area = 'G' and stato = 'proposto');
create policy "agente ceramex" on public.eventi for select to agente_ceramex using (area = 'C');
create policy "agente ceramex propone" on public.eventi for insert to agente_ceramex with check (area = 'C' and stato = 'proposto');
grant execute on function public.utente_predefinito() to agente_ceramex;

-- La call c'è già nel calendario (accettata da Giovanni, già proposta o già scartata)? Risponde solo sì/no,
-- così gli agenti non vedono gli appuntamenti delle altre aree (privati compresi).
create or replace function public.call_gia_in_calendario(p_inizio timestamptz, p_titolo text, p_link text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.eventi e
    where e.stato in ('confermato', 'proposto', 'da_creare', 'scartato')
      and e.inizio between p_inizio - interval '10 minutes' and p_inizio + interval '10 minutes'
      and (
        (p_link is not null and length(p_link) > 20 and coalesce(e.descrizione, '') like '%' || p_link || '%')
        or lower(trim(e.titolo)) = lower(trim(p_titolo))
        or concat_ws(' ', e.titolo, e.luogo, e.descrizione) ~* '(teams|zoom|meet\.google|webex|call)'
      )
  )
$$;
revoke all on function public.call_gia_in_calendario(timestamptz, text, text) from public, anon;
grant execute on function public.call_gia_in_calendario(timestamptz, text, text) to agente_gc, agente_ceramex, service_role;

-- L'agente Ceramex può fare una domanda quando un invito nella Gmail non dice data e ora (come l'agente G&C).
grant select, insert, update on public.domande to agente_ceramex;
drop policy if exists "agente ceramex" on public.domande;
create policy "agente ceramex" on public.domande for all to agente_ceramex
  using (area = 'C' and agente = 'ceramex') with check (area = 'C' and agente = 'ceramex');
