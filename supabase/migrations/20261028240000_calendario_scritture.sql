-- Calendario tappa 2 (28.10.2026, ok di Giovanni: "vai avanti con tappa 2-3"): anche creare, spostare e colorare li
-- fa la funzione calendario-copia col client di Giovanni (permesso calendar.events), non più l'agente col connettore.

-- Chi ha messo il cambio o il 'da_creare' (current_user di chi scrive). La funzione esegue solo quelli dell'app
-- (authenticated), dei trigger del database (postgres: eventi messi da soli dalle note di Giovanni) e dell'agente
-- calendario (richieste di Giovanni). Gli altri (es. il Capo, che legge mail di estranei) tornano proposte da
-- approvare nell'app.
alter table public.eventi add column if not exists cambio_da text;
alter table public.eventi add column if not exists da_creare_da text;
-- Un evento che Google non lascia colorare si riprova il giorno dopo (colonna a parte: la copia riscrive "google").
alter table public.eventi add column if not exists colore_errore_il timestamptz;

-- Le due colonne le scrive solo questo trigger: un valore messo a mano da chi scrive non vale.
create or replace function public.eventi_chi_scrive()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.cambio_da := case when new.cambio is not null then current_user end;
    new.da_creare_da := case when new.stato = 'da_creare' then current_user end;
  else
    -- Chi cambia il cambio, o l'evento a cui si riferisce, diventa quello che l'ha chiesto.
    new.cambio_da := case when new.cambio is null then null
                          when new.cambio is distinct from old.cambio or new.google_id is distinct from old.google_id
                            then current_user else old.cambio_da end;
    -- Lo stesso per un 'da_creare' a cui si cambia il contenuto prima che vada in Google.
    new.da_creare_da := case when new.stato is distinct from 'da_creare' then old.da_creare_da
                             when old.stato is distinct from 'da_creare'
                               or (new.titolo, new.inizio, new.fine, new.tutto_il_giorno, new.luogo, new.descrizione, new.google_id)
                                  is distinct from (old.titolo, old.inizio, old.fine, old.tutto_il_giorno, old.luogo, old.descrizione, old.google_id)
                               then current_user else old.da_creare_da end;
  end if;
  return new;
end $$;
drop trigger if exists eventi_chi_scrive on public.eventi;
create trigger eventi_chi_scrive before insert or update on public.eventi
  for each row execute function public.eventi_chi_scrive();
