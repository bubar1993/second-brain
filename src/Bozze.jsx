import { useEffect, useRef, useState } from 'react'
import { sb, quando } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro, useModifiche } from './componenti'

// Bozze di risposta dell'agente G&C (casella info@homeconcepts.ch).
// Giovanni le approva (partono da info@) o le scarta. Se qualcuno risponde prima, si annullano da sole.

const CAMPI = 'id,stato,oggetto,a,testo,perche,creata_il,annullata_il,motivo_annullata,errore,aziende(id,nome),posta(id,da,da_nome,data)'

export function Bozze({ scelta }) {
  const [annullate, setAnnullate] = useState(false)
  const { dati, errore, carica } = useCarica(async () => {
    const settimana = new Date(Date.now() - 7 * 86400000).toISOString()
    const [aperte, vecchie] = await Promise.all([
      sb.from('bozze').select(CAMPI).in('stato', ['proposta', 'in_invio']).order('creata_il', { ascending: false }).then(chk),
      sb.from('bozze').select(CAMPI).in('stato', ['annullata', 'inviata', 'scartata', 'da_imparare']).gte('modificata_il', settimana)
        .order('modificata_il', { ascending: false }).limit(30).then(chk),
    ])
    return { aperte, vecchie }
  }, [])

  return (
    <div className="schermata">
      <Indietro titolo="Bozze G&C" />
      <p className="nota-piccola">Risposte preparate per info@homeconcepts.ch. Tocca per leggerle, correggerle e inviarle.</p>
      <Stato carica={carica} errore={errore} vuoto={dati && !dati.aperte.length && !dati.vecchie.length ? 'Nessuna bozza da approvare.' : null}>
        {dati && (
          <>
            {dati.aperte.length > 0
              ? <div className="elenco">{dati.aperte.map((b) => <RigaBozza key={b.id} b={b} scelta={scelta} />)}</div>
              : <p className="msg">Nessuna bozza da approvare.</p>}
            {dati.vecchie.length > 0 && (
              <>
                <button type="button" className="tasto-link" onClick={() => setAnnullate(!annullate)}>
                  {annullate ? 'Nascondi gli ultimi 7 giorni' : `Ultimi 7 giorni: ${dati.vecchie.length} inviate, scartate o annullate`}
                </button>
                {annullate && <div className="elenco">{dati.vecchie.map((b) => <RigaBozza key={b.id} b={b} scelta={scelta} />)}</div>}
              </>
            )}
          </>
        )}
      </Stato>
    </div>
  )
}

function RigaBozza({ b, scelta }) {
  const chi = b.aziende?.nome || b.posta?.da_nome || b.a?.[0] || ''
  const stato = b.stato === 'annullata' ? 'annullata' : b.stato === 'inviata' ? 'inviata'
    : b.stato === 'scartata' || b.stato === 'da_imparare' ? 'scartata' : b.errore ? 'da riprovare' : null
  const spenta = ['annullata', 'scartata', 'da_imparare'].includes(b.stato)
  return (
    <a className={'riga riga-bozza' + (scelta === b.id ? ' scelta' : '') + (spenta ? ' spenta' : '')} href={`#/bozza/${b.id}`}>
      <span className="riga-corpo">
        <span className="riga-testo"><b>{chi}</b> — {b.oggetto || '(senza oggetto)'}</span>
        <span className="riga-meta">
          {stato && <span className={'etichetta-sezione' + (b.errore && b.stato === 'proposta' ? ' rosso' : '')}>{stato}</span>}{' '}
          {b.perche?.motivo || b.testo?.slice(0, 90)}
        </span>
      </span>
      <span className="data-breve">{quando(b.creata_il)}</span>
    </a>
  )
}

// Una bozza: la mail a cui risponde, il testo da correggere, Approva e invia / Scarta.
export function Bozza({ id }) {
  const { avvisa } = useApp()
  const [campi, setCampi] = useState(null)
  const [conferma, setConferma] = useState(false)
  const [confermaScarta, setConfermaScarta] = useState(false)
  const [lavoro, setLavoro] = useState(false)
  const timer = useRef(null)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const b = chk(await sb.from('bozze').select('*,aziende(id,nome),posta(id,message_id,da,da_nome,a,cc,oggetto,data,testo)').eq('id', id).single())
    return b
  }, [id])

  useEffect(() => {
    if (dati && !campi) setCampi({ a: (dati.a || []).join(', '), cc: (dati.cc || []).join(', '), oggetto: dati.oggetto || '', testo: dati.testo || '' })
  }, [dati, campi])
  useEffect(() => () => clearTimeout(timer.current), [])
  const corretta = !!dati && !!campi && dati.stato === 'proposta' && (campi.testo !== (dati.testo || '') || campi.oggetto !== (dati.oggetto || '')
    || campi.a !== (dati.a || []).join(', ') || campi.cc !== (dati.cc || []).join(', '))
  useModifiche(corretta)

  if (!dati || !campi) return <div className="schermata"><Indietro titolo="Bozza" /><Stato carica={carica} errore={errore} /></div>

  const b = dati
  const aperta = b.stato === 'proposta'
  const lista = (s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
  const cambia = (k) => (e) => setCampi({ ...campi, [k]: e.target.value })

  // Due tocchi per inviare: la mail parte davvero.
  async function invia() {
    if (!conferma) {
      setConferma(true)
      setConfermaScarta(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setConferma(false), 5000)
      return
    }
    clearTimeout(timer.current)
    setConferma(false)
    setLavoro(true)
    try {
      const { data, error } = await sb.functions.invoke('invia-bozza', {
        body: { id, testo: campi.testo, a: lista(campi.a), cc: lista(campi.cc), oggetto: campi.oggetto },
      })
      if (error) {
        let msg = error.message
        try { msg = (await error.context.json()).errore || msg } catch { /* resta il messaggio */ }
        throw new Error(msg)
      }
      if (data?.errore) throw new Error(data.errore)
      avvisa('Inviata da info@')
      location.replace('#/bozze') // "indietro" non riporta alla bozza già mandata
    } catch (e) {
      avvisa(messaggioErrore(e))
      ricarica()
    } finally {
      setLavoro(false)
    }
  }

  // Anche scartare vuole due tocchi: non si torna indietro.
  async function scarta() {
    if (!confermaScarta) {
      setConfermaScarta(true)
      setConferma(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setConfermaScarta(false), 5000)
      return
    }
    clearTimeout(timer.current)
    setConfermaScarta(false)
    setLavoro(true)
    try {
      chk(await sb.from('bozze').update({ stato: 'scartata', testo: campi.testo }).eq('id', id))
      avvisa('Scartata')
      location.replace('#/bozze')
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  return (
    <div className="schermata bozza">
      <Indietro titolo={b.aziende?.nome || b.posta?.da_nome || 'Bozza'} />
      {b.stato === 'annullata' && <div className="scheda scheda-allarme"><p>Annullata: {b.motivo_annullata}</p></div>}
      {b.stato === 'inviata' && <p className="nota-piccola">Inviata {quando(b.inviata_il, true)}.</p>}
      {b.stato === 'scartata' && <p className="nota-piccola">Scartata.</p>}
      {b.errore && aperta && <div className="scheda scheda-allarme"><p>{b.errore}</p></div>}
      {b.perche?.motivo && <p className="perche">{b.perche.motivo}</p>}

      {b.posta && <MailOriginale m={b.posta} />}

      <div className="modulo">
        <label>A<input type="text" value={campi.a} onChange={cambia('a')} disabled={!aperta} inputMode="email" /></label>
        <label>Cc<input type="text" value={campi.cc} onChange={cambia('cc')} disabled={!aperta} inputMode="email" placeholder="nessuno" /></label>
        <label>Oggetto<input type="text" value={campi.oggetto} onChange={cambia('oggetto')} disabled={!aperta} /></label>
      </div>
      <textarea className="testo-bozza" value={campi.testo} onChange={cambia('testo')} rows={8} disabled={!aperta} />

      {aperta && (
        <div className="azioni azioni-bozza">
          <button type="button" className={'tasto-grande' + (conferma ? ' conferma' : '')} onClick={invia} disabled={lavoro}>
            {lavoro ? 'Invio…' : conferma ? 'Tocca ancora per inviare' : 'Approva e invia'}
          </button>
          <button type="button" className={'tasto-link' + (confermaScarta ? ' pericolo-pieno' : '')} onClick={scarta} disabled={lavoro}>
            {confermaScarta ? 'Tocca ancora per scartare' : 'Scarta'}
          </button>
        </div>
      )}
      {(b.perche?.fonti || []).length > 0 && (
        <p className="nota-piccola">Fonti: {b.perche.fonti.join(' · ')}</p>
      )}
    </div>
  )
}

// La parte nuova di una mail (senza le citazioni), con "Mostra tutto".
function parteNuova(testo) {
  const righe = (testo || '').split('\n')
  const fine = righe.findIndex((r) => /^\s*>/.test(r) || /^(Il .+ha scritto:|On .+wrote:|Am .+schrieb.*:|Von: |From: |Da: |-----\s*Original)/i.test(r.trim()))
  return fine > 0 ? righe.slice(0, fine).join('\n').trim() : (testo || '').trim()
}

function MailOriginale({ m, classe = '' }) {
  const [tutto, setTutto] = useState(false)
  const nuova = parteNuova(m.testo)
  const lunga = (m.testo || '').trim().length > nuova.length + 20
  return (
    <div className={'mail-originale ' + classe}>
      <p className="nota-piccola"><b>{m.da_nome || m.da}</b>{m.da_nome && m.da ? ` <${m.da}>` : ''} · {quando(m.data, true)}</p>
      {m.oggetto && <p className="mail-oggetto">{m.oggetto}</p>}
      <p className="mail-testo">{tutto ? m.testo : nuova}</p>
      {lunga && <button type="button" className="tasto-link" onClick={() => setTutto(!tutto)}>{tutto ? 'Solo la parte nuova' : 'Mostra tutta la mail'}</button>}
    </div>
  )
}

// La conversazione di una mail (dal link "dalla mail" delle note G&C).
export function Mail({ chiave }) {
  const messageId = decodeURIComponent(chiave || '')
  const { dati, errore, carica } = useCarica(async () => {
    const [m] = chk(await sb.from('posta').select('thread_key').eq('message_id', messageId).limit(1))
    if (!m) return []
    return chk(await sb.from('posta').select('id,message_id,cartella,da,da_nome,oggetto,data,testo')
      .eq('thread_key', m.thread_key).order('data', { ascending: true }).limit(60))
  }, [messageId])

  return (
    <div className="schermata">
      <Indietro titolo={dati?.[0]?.oggetto || 'Mail'} />
      <Stato carica={carica} errore={errore} vuoto={dati && !dati.length ? 'Mail non trovata.' : null}>
        {dati && (
          <div className="conversazione">
            {dati.map((m) => (
              <MailOriginale key={m.id} m={{ ...m, oggetto: null }}
                classe={(m.cartella === 'inviata' ? 'inviata' : '') + (m.message_id === messageId ? ' questa' : '')} />
            ))}
          </div>
        )}
      </Stato>
    </div>
  )
}
