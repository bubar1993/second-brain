-- Portinaio del calendario, correzioni dell'antagonista prima di passare la routine a 6, 12 e 18 (26.10.2026):
-- 1) un evento che non si riesce a creare non risveglia più l'agente: contano solo gli eventi 'da_creare' senza
--    errore, e "nuovi" rispetto all'ultimo giro nel registro (non all'ultima partenza: così anche un "Fallo
--    adesso", che fa solo le richieste, non fa saltare un appuntamento appena approvato). I giri fissi riprovano.
-- 2) calendario_novita: dei cambi letti da Google conta solo quelli che l'agente non ha già copiato nel database
--    (i colori e gli eventi messi da lui hanno eventi.modificata_il dopo l'ora del cambio in Google).
create or replace function public.portinaio_lavoro(p_agente text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
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
    'richieste', (select count(*) from richieste_agenti where agente = 'calendario' and stato = 'nuova' and creata_il > dal)
  ) from d)
  end
$$;
revoke all on function public.portinaio_lavoro(text) from public, anon, authenticated;
grant execute on function public.portinaio_lavoro(text) to service_role;

-- Cambi di Google ([{id, updated}]) che il database non ha ancora: evento sconosciuto, oppure copiato prima del
-- cambio (5 secondi di margine per l'orologio di Google).
create or replace function public.calendario_novita(p_cambi jsonb) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int
  from jsonb_to_recordset(coalesce(p_cambi, '[]')) as c(id text, updated timestamptz)
  where not exists (select 1 from eventi e where e.google_id = c.id and e.modificata_il >= c.updated - interval '5 seconds')
$$;
revoke all on function public.calendario_novita(jsonb) from public, anon, authenticated;
grant execute on function public.calendario_novita(jsonb) to service_role;
