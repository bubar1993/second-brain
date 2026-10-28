-- Copia da Google Calendar fatta da una funzione, non più dall'agente (28.10.2026, ok di Giovanni, tappa 1).
-- Dal 26.10 il connettore Google Calendar di claude.ai risponde "quota esaurita". La funzione calendario-copia legge
-- Google con il client di Giovanni (calendar.readonly, quota sua) ogni 10 minuti e copia qui con calendario_copia().
-- L'agente calendario usa il connettore solo per scrivere (creare, spostare, colorare).

-- Quello che serve all'agente per non leggere più Google: colore attuale (colorId), tipo (eventType), mio (Giovanni è
-- l'organizzatore), serie (recurringEventId), updated. Lo scrive solo la copia (e l'agente dopo un colore o una creazione).
alter table public.eventi add column if not exists google jsonb;

-- Copia: p_eventi = eventi di Google (Events.list con singleEvents e showDeleted). Con p_finestra la lista è COMPLETA
-- per [p_dal, p_al): risponde in "mancanti" gli eventi del database in quella finestra che Google non ha dato (la
-- funzione li rilegge uno per uno e li ripassa con p_finestra = false). Regole come la copia dell'agente: upsert per
-- google_id, area/ditta/persona non si toccano, 'cancellato' solo per gli eventi che Google dà come cancellati (o
-- che Giovanni ha rifiutato). Compleanni e "dove lavoro" (birthday, workingLocation) non si copiano.
-- Righe con un cambio in corso (eventi.cambio) o toccate dopo la lettura di Google (p_letto_il) saltate.
-- Si aggiorna solo se qualcosa è cambiato davvero.
-- Un evento nuovo in Google con lo stesso titolo e la stessa ora di una riga 'da_creare' senza google_id è quella
-- riga (l'agente l'ha appena creato e non ha ancora scritto il google_id): la riga prende il google_id, niente doppioni.
-- Freni: più di p_max_mancanti mancanti → errore prima di scrivere (id cambiati? controllare a mano); cancellati di
-- più di p_max_serie serie/eventi diversi in una volta → nessuno, e "freno" nella risposta (per sbloccare a mano:
-- docs/calendario.md).
-- Con p_prova fa tutto, risponde e poi annulla.
create or replace function public.calendario_copia(p_eventi jsonb, p_dal timestamptz, p_al timestamptz,
  p_letto_il timestamptz, p_finestra boolean default true, p_prova boolean default false,
  p_max_serie int default 10, p_max_mancanti int default 150)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  esito jsonb;
  mancanti jsonb := '[]';
  n_serie int;
begin
  begin
    create temp table g on commit drop as
    select x.*, x.google->>'tipo' in ('birthday', 'workingLocation') as escluso
    from (
      select e->>'id' as google_id,
             case when e->>'status' = 'cancelled' or exists (select 1 from jsonb_array_elements(coalesce(e->'attendees', '[]')) a
                    where coalesce((a->>'self')::boolean, false) and a->>'responseStatus' = 'declined') then 'cancelled'
                  else 'confirmed' end as status,
             coalesce(nullif(e->>'summary', ''), '(senza titolo)') as titolo,
             coalesce((e->'start'->>'dateTime')::timestamptz, ((e->'start'->>'date')::date)::timestamp at time zone 'UTC') as inizio,
             coalesce((e->'end'->>'dateTime')::timestamptz, ((e->'end'->>'date')::date)::timestamp at time zone 'UTC') as fine,
             (e->'start' ? 'date') as tutto,
             nullif(e->>'location', '') as luogo,
             left(nullif(e->>'description', ''), 4000) as descrizione,
             coalesce((select array_agg(a->>'email' order by a->>'email') from jsonb_array_elements(coalesce(e->'attendees', '[]')) a
                       where a->>'email' is not null and not coalesce((a->>'self')::boolean, false)
                         and not coalesce((a->>'resource')::boolean, false)), '{}') as partecipanti,
             jsonb_strip_nulls(jsonb_build_object('colore', e->>'colorId', 'tipo', coalesce(e->>'eventType', 'default'),
               'mio', coalesce((e->'organizer'->>'self')::boolean, false), 'serie', e->>'recurringEventId',
               'updated', e->>'updated')) as google
      from jsonb_array_elements(coalesce(p_eventi, '[]')) e
      where e->>'id' is not null
    ) x;

    if p_finestra then
      select coalesce(jsonb_agg(e.google_id), '[]') into mancanti from eventi e
       where e.google_id is not null and e.stato = 'confermato' and e.cambio is null
         and e.inizio >= p_dal and e.inizio < p_al
         and not exists (select 1 from g where g.google_id = e.google_id);
      if jsonb_array_length(mancanti) > p_max_mancanti then
        raise exception '% eventi del database non ci sono più nella lettura di Google: non copio niente, controllare a mano',
          jsonb_array_length(mancanti);
      end if;
    end if;

    select count(distinct coalesce(g.google->>'serie', g.google_id)) into n_serie from eventi e join g on g.google_id = e.google_id
     where g.status = 'cancelled' and not g.escluso and e.stato <> 'cancellato' and e.cambio is null and e.modificata_il <= p_letto_il;

    with da_vedere as (
      select e.titolo, array_remove(array[
        case when e.titolo is distinct from g.titolo then 'titolo' end,
        case when e.inizio is distinct from g.inizio then 'inizio' end,
        case when e.fine is distinct from g.fine then 'fine' end,
        case when e.tutto_il_giorno is distinct from g.tutto then 'tutto_il_giorno' end,
        case when e.luogo is distinct from g.luogo then 'luogo' end,
        case when e.descrizione is distinct from g.descrizione then 'descrizione' end,
        case when e.partecipanti is distinct from g.partecipanti then 'partecipanti' end,
        case when e.stato is distinct from 'confermato' then 'stato' end], null) as campi
      from eventi e join g on g.google_id = e.google_id
      where g.status <> 'cancelled' and not g.escluso and e.cambio is null
    ), adottati as (
      update eventi e set google_id = g.google_id, stato = 'confermato', errore = null, google = g.google
      from g where g.status <> 'cancelled' and not g.escluso and e.stato = 'da_creare' and e.google_id is null
        and e.titolo = g.titolo
        and abs(extract(epoch from e.inizio - g.inizio)) <= case when e.tutto_il_giorno then 7200 else 60 end
        and not exists (select 1 from eventi x where x.google_id = g.google_id)
      returning e.titolo, e.inizio
    ), nuovi as (
      insert into eventi (google_id, titolo, inizio, fine, tutto_il_giorno, luogo, descrizione, partecipanti, google, stato)
      select g.google_id, g.titolo, g.inizio, g.fine, g.tutto, g.luogo, g.descrizione, g.partecipanti, g.google, 'confermato'
      from g where g.status <> 'cancelled' and not g.escluso
        and not exists (select 1 from eventi e where e.google_id = g.google_id)
        and not exists (select 1 from eventi e where e.stato = 'da_creare' and e.google_id is null and e.titolo = g.titolo
                          and abs(extract(epoch from e.inizio - g.inizio)) <= case when e.tutto_il_giorno then 7200 else 60 end)
      on conflict (google_id) do nothing
      returning titolo, inizio
    ), agg as (
      update eventi e set titolo = g.titolo, inizio = g.inizio, fine = g.fine, tutto_il_giorno = g.tutto, luogo = g.luogo,
             descrizione = g.descrizione, partecipanti = g.partecipanti, google = g.google, stato = 'confermato'
      from g where g.status <> 'cancelled' and not g.escluso and e.google_id = g.google_id and e.cambio is null
        and e.modificata_il <= p_letto_il
        and (e.titolo, e.inizio, e.fine, e.tutto_il_giorno, e.luogo, e.descrizione, e.partecipanti, e.google, e.stato)
            is distinct from (g.titolo, g.inizio, g.fine, g.tutto, g.luogo, g.descrizione, g.partecipanti, g.google, 'confermato')
      returning e.id
    ), canc as (
      update eventi e set stato = 'cancellato'
      from g where n_serie <= p_max_serie and g.status = 'cancelled' and not g.escluso and e.google_id = g.google_id
        and e.stato <> 'cancellato' and e.cambio is null and e.modificata_il <= p_letto_il
      returning e.titolo, e.inizio
    )
    select jsonb_build_object(
      'letti', (select count(*) from g),
      'esclusi', (select count(*) from g where escluso),
      'adottati', (select count(*) from adottati),
      'nuovi', (select count(*) from nuovi),
      'aggiornati', (select count(*) from agg),
      'cancellati', (select count(*) from canc),
      'freno', n_serie > p_max_serie,
      'nuovi_titoli', (select coalesce(jsonb_agg(titolo || ' ' || to_char(inizio at time zone 'Europe/Zurich', 'DD.MM HH24:MI')), '[]') from (select * from nuovi limit 20) x),
      'cancellati_titoli', (select coalesce(jsonb_agg(titolo || ' ' || to_char(inizio at time zone 'Europe/Zurich', 'DD.MM HH24:MI')), '[]') from (select * from canc limit 20) x),
      'cambi_campi', (select coalesce(jsonb_agg(jsonb_build_object('titolo', titolo, 'campi', campi)), '[]')
                        from (select * from da_vedere where cardinality(campi) > 0 limit 40) x),
      'mancanti', mancanti
    ) into esito;

    if p_prova then raise exception 'prova annullata' using errcode = 'P0001'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'prova annullata' then raise; end if;
  end;
  return esito || jsonb_build_object('prova', p_prova);
end $$;

-- Solo la funzione calendario-copia (service_role): né l'app né gli agenti.
revoke all on function public.calendario_copia(jsonb, timestamptz, timestamptz, timestamptz, boolean, boolean, int, int) from public, anon, authenticated;
grant execute on function public.calendario_copia(jsonb, timestamptz, timestamptz, timestamptz, boolean, boolean, int, int) to service_role;

-- L'agente calendario non copia più e non segna più niente 'cancellato' (lo fa la copia): il database glielo rifiuta,
-- così un giro senza Google non può cancellare tutta la finestra.
create or replace function public.eventi_agente_calendario_freno()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'agente_calendario' and new.stato = 'cancellato' and old.stato is distinct from 'cancellato' then
    raise exception 'L''agente calendario non segna eventi cancellati: lo fa la copia da Google';
  end if;
  return new;
end $$;
drop trigger if exists eventi_agente_calendario_freno on public.eventi;
create trigger eventi_agente_calendario_freno before update of stato on public.eventi
  for each row execute function public.eventi_agente_calendario_freno();

-- Portinaio: per il calendario conta anche gli eventi nuovi copiati da Google dopo l'ultimo giro (da abbinare a
-- ditta e area e da colorare). Il resto come prima.
create or replace function public.portinaio_lavoro(p_agente text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with x as (
    select (select max(iniziata_il) from lavori_registro
             where lavoro = case p_agente when 'gc' then 'agente-gc' when 'calendario' then 'agente-calendario'
                                          else 'agente-smistatore' end) as registro,
           greatest((select ultima_sveglia from portinaio where agente = p_agente),
                    (select ultima from sveglie where agente = p_agente),
                    (select max(avviata_il) from richieste_agenti where agente = p_agente)) as partenza
  ), d as (
    -- il registro si scrive alla FINE del giro: 10 minuti di margine per le cose arrivate durante il giro
    select x.*, greatest(x.partenza, x.registro - interval '10 minutes', now() - interval '1 day') as dal,
           -- calendario: 30 minuti, perché spostamenti e creazioni si fanno all'inizio di un giro che dura parecchio
           greatest(x.registro - interval '30 minutes', now() - interval '1 day') as dal_giro from x
  )
  select case p_agente
  when 'gc' then (select jsonb_build_object(
    'registro', registro, 'partenza', partenza, 'dal', dal,
    'mail', (select count(*) from posta where vista_il is null and creata_il > dal),
    'mail_ferme', (select count(*) from posta where vista_il is null and creata_il < now() - interval '40 minutes'),
    'parcheggio', (select count(*) from note where area = 'G' and azienda_id = '823be55a-9f6b-4a48-b518-5f7d4f4c2081'
                     and eliminata_il is null and greatest(creata_il, modificata_il) > dal),
    'note_cambiate', (select count(*) from note where area = 'G' and fonte = 'mail' and imparata = false
                        and (scartata_il > dal or (modificata_il > dal and (testo <> testo_agente or sezione <> sezione_agente)))),
    'bozze', (select count(*) from bozze where area = 'G' and imparata = false and stato in ('inviata', 'scartata')
                and greatest(inviata_il, modificata_il, annullata_il) > dal),
    'risposte', (select count(*) from domande where agente = 'gc' and risposta_il > dal),
    'richieste', (select count(*) from richieste_agenti where agente = 'gc' and stato = 'nuova' and creata_il > dal)
  ) from d)
  when 'smistatore' then (select jsonb_build_object(
    'registro', registro, 'partenza', partenza, 'dal', dal,
    'richieste', (select count(*) from richieste_agenti where agente = 'smistatore' and stato = 'nuova' and creata_il > dal),
    'domande', (select count(*) from domande where area in ('C', 'G') and risposta_il is null and smistata_il is null
                  and creata_il > dal),
    'risposte', (select count(*) from domande where area in ('C', 'G') and risposta_il > dal and smistata_il is null
                   and risposta not like 'Ci pensa lo smistatore%'),
    'non_fatte', (select count(*) from richieste_agenti r where stato = 'non_fatta' and agente <> 'privato'
                    and risposta_il > dal and not exists (select 1 from richieste_agenti r2 where r2.origine_id = r.id)),
    'seguiti', (select count(*) from richieste_agenti r where da = 'smistatore' and stato = 'fatta' and seguito_agente is not null
                  and risposta_il > dal and not exists (select 1 from richieste_agenti r2 where r2.origine_id = r.id)),
    'seguiti_in_attesa', (select count(*) from richieste_agenti r where da = 'smistatore' and stato = 'fatta'
                            and seguito_agente is not null and risposta_il <= dal
                            and not exists (select 1 from richieste_agenti r2 where r2.origine_id = r.id))
  ) from d)
  when 'calendario' then (select jsonb_build_object(
    'registro', registro, 'partenza', partenza, 'dal', dal,
    'da_creare', (select count(*) from eventi where stato = 'da_creare' and google_id is null and errore is null
                    and modificata_il > dal_giro),
    'cambi', (select count(*) from eventi where cambio is not null and errore is null and cambio_il > dal_giro),
    'richieste', (select count(*) from richieste_agenti where agente = 'calendario' and stato = 'nuova' and creata_il > dal),
    'nuovi', (select count(*) from eventi where google_id is not null and stato = 'confermato' and creata_il > dal)
  ) from d)
  end
$function$;
