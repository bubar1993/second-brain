-- 14.10.2026 (ok di Giovanni): gli agenti lavorano anche di notte (fino alle 3, poi dalle 6).
-- 1) Il punto del mattino non si scrive tra mezzanotte e le 6 (ora svizzera): sarebbe il "mattino" del giorno dopo
--    scritto all'una di notte. La riga viene semplicemente lasciata stare (nessun errore per l'agente).
create or replace function public.riassunti_non_di_notte() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.momento = 'mattino' and extract(hour from (now() at time zone 'Europe/Zurich')) < 6 then
    if tg_op = 'UPDATE' then return old; end if;
    return null;
  end if;
  return new;
end $$;
drop trigger if exists riassunti_non_di_notte on public.riassunti_giorno;
create trigger riassunti_non_di_notte before insert or update on public.riassunti_giorno
  for each row execute function public.riassunti_non_di_notte();

-- 2) "Chiedimelo di nuovo…": quando Giovanni risponde così a una domanda di un agente, la stessa domanda torna da sola
--    al momento giusto (prima l'agente chiudeva la domanda e basta: il 12.10 si è persa quella su passaporti e ID).
--    Fine settimana / weekend → sabato alle 9; domani → domani alle 9; lunedì → lunedì alle 9; altrimenti tra 14 giorni alle 9.
create or replace function public.domanda_richiedimelo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r text := lower(coalesce(new.risposta, ''));
  oggi date := (now() at time zone 'Europe/Zurich')::date;
  quando date;
begin
  if old.risposta is not null or new.risposta is null then return new; end if;
  if r !~ '(ri)?chiedimel|chiedimi.*(di nuovo|ancora|pi[uù] avanti)|ripropon|ricordamel[oa] (pi[uù] avanti|nel|la prossima)' then return new; end if;
  if r ~ 'fine settimana|weekend|sabato' then quando := oggi + ((6 - extract(isodow from oggi)::int + 7) % 7);
    if quando = oggi then quando := oggi + 7; end if;
  elsif r ~ 'domenica' then quando := oggi + ((7 - extract(isodow from oggi)::int + 7) % 7);
    if quando = oggi then quando := oggi + 7; end if;
  elsif r ~ 'domani' then quando := oggi + 1;
  elsif r ~ 'luned' then quando := oggi + ((1 - extract(isodow from oggi)::int + 7) % 7);
    if quando = oggi then quando := oggi + 7; end if;
  elsif r ~ 'settimana prossima|tra una settimana' then quando := oggi + 7;
  elsif r ~ 'mese' then quando := oggi + 30;
  else quando := oggi + 14;
  end if;
  insert into domande (utente_id, area, agente, testo, scelte, nota_id, persona_id, azienda_id, mostra_dal)
  values (new.utente_id, new.area, new.agente, new.testo, new.scelte, new.nota_id, new.persona_id, new.azienda_id,
          (quando + time '09:00') at time zone 'Europe/Zurich');
  return new;
end $$;
revoke all on function public.domanda_richiedimelo() from public, anon;
drop trigger if exists domanda_richiedimelo on public.domande;
create trigger domanda_richiedimelo after update of risposta on public.domande
  for each row execute function public.domanda_richiedimelo();
