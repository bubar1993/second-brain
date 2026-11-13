-- "Chiedi al Capo" da una nota (13.11.2026, ok di Giovanni, piano controllato dall'antagonista).
-- La richiesta al Capo porta il collegamento alla nota (il testo della nota NON va nella richiesta: è un dato).
alter table public.richieste_agenti add column if not exists nota_id uuid references public.note(id) on delete set null;
create index if not exists richieste_agenti_nota_idx on public.richieste_agenti (nota_id) where nota_id is not null;

-- Portinaio: i seguiti li manda lo Smistatore anche per i lavori passati dal Capo (es. cliente nuovo G&C:
-- archiviazione lo crea nel gestionale, poi 'lavoro' collega la nota). Prima contava solo da = 'smistatore'.
-- Il resto come nella migrazione calendario_copia (28.10.2026).
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
    'seguiti', (select count(*) from richieste_agenti r where da in ('smistatore', 'capo') and stato = 'fatta' and seguito_agente is not null
                  and risposta_il > dal and not exists (select 1 from richieste_agenti r2 where r2.origine_id = r.id)),
    'seguiti_in_attesa', (select count(*) from richieste_agenti r where da in ('smistatore', 'capo') and stato = 'fatta'
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
