import { useEffect, useRef, useState } from 'react'
import { sb, quando, areaDa } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Indietro, useModifiche } from './componenti'

// Bozze di risposta preparate dagli agenti:
// - G&C: casella info@homeconcepts.ch, partono da info@ (funzione invia-bozza);
// - Ceramex: la routine "Bozze mail Ceramex" le crea nella Gmail di Giovanni, partono da lì (funzione gmail-bozza).
// Giovanni le approva o le scarta. Se qualcuno risponde prima, si annullano da sole.
// Le mail Ceramex a cui l'agente non sapeva rispondere stanno in "Da rispondere tu".

const CAMPI = 'id,area,canale,stato,oggetto,a,testo,perche,da_nome,creata_il,annullata_il,motivo_annullata,errore,aziende(id,nome),posta(id,da,da_nome,data)'
const GMAIL_WEB = 'https://mail.google.com/mail/?authuser=giovannifabris%40ceramex.ch#all/'

export function Bozze({ scelta }) {
  const { area } = useApp()
  const [annullate, setAnnullate] = useState(false)
  const { dati, errore, carica } = useCarica(async () => {
    const settimana = new Date(Date.now() - 7 * 86400000).toISOString()
    const q = () => {
      const x = sb.from('bozze').select(CAMPI)
      return area === 'T' ? x : x.eq('area', area)
    }
    const [aperte, daRispondere, vecchie] = await Promise.all([
      q().in('stato', ['proposta', 'in_invio']).order('creata_il', { ascending: false }).then(chk),
      q().eq('canale', 'gmail').eq('stato', 'da_imparare').gte('creata_il', settimana).order('creata_il', { ascending: false }).then(chk),
      q().in('stato', ['annullata', 'inviata', 'scartata', 'da_imparare']).gte('modificata_il', settimana)
        .order('modificata_il', { ascending: false }).limit(30).then(chk),
    ])
    return { aperte, daRispondere, vecchie: vecchie.filter((b) => !(b.canale === 'gmail' && b.stato === 'da_imparare')) }
  }, [area])

  return (
    <div className="schermata">
      <Indietro titolo="Bozze" />
      <p className="nota-piccola">Risposte preparate dagli agenti: G&C parte da info@, Ceramex dalla tua Gmail. Tocca per leggerle, correggerle e inviarle.</p>
      <Stato carica={carica} errore={errore} vuoto={dati && !dati.aperte.length && !dati.daRispondere.length && !dati.vecchie.length ? 'Nessuna bozza da approvare.' : null}>
        {dati && (
          <>
            {dati.aperte.length > 0
              ? <div className="elenco">{dati.aperte.map((b) => <RigaBozza key={b.id} b={b} scelta={scelta} />)}</div>
              : <p className="msg">Nessuna bozza da approvare.</p>}
            {dati.daRispondere.length > 0 && (
              <>
                <h3>Da rispondere tu</h3>
                <p className="nota-piccola">Mail Ceramex a cui l'agente non ha risposto: gli mancava un dato certo. Spariscono quando rispondi da Gmail.</p>
                <div className="elenco">{dati.daRispondere.map((b) => <RigaBozza key={b.id} b={b} scelta={scelta} />)}</div>
              </>
            )}
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
  const chi = b.aziende?.nome || b.posta?.da_nome || b.da_nome || b.a?.[0] || ''
  const daTe = b.canale === 'gmail' && b.stato === 'da_imparare'
  const stato = daTe ? 'da rispondere tu' : b.stato === 'annullata' ? 'annullata' : b.stato === 'inviata' ? 'inviata'
    : b.stato === 'scartata' || b.stato === 'da_imparare' ? 'scartata' : b.errore ? 'da riprovare' : null
  const spenta = ['annullata', 'scartata'].includes(b.stato) || (b.stato === 'da_imparare' && !daTe)
  return (
    <a className={'riga riga-bozza' + (scelta === b.id ? ' scelta' : '') + (spenta ? ' spenta' : '')} href={`#/bozza/${b.id}`}>
      <span className="pallino" style={{ background: areaDa(b.area)?.colore || 'var(--grigio)' }} />
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
    if (b.canale !== 'gmail') return b
    // Ceramex: destinatari, testo e mail originale si leggono dalla Gmail (la bozza vera sta lì).
    try {
      const g = await chiama('gmail-bozza', { azione: 'leggi', id })
      return { ...b, gmail: g, ...(g.bozza ? { a: g.bozza.a, cc: g.bozza.cc, oggetto: g.bozza.oggetto, testo: g.bozza.testo } : {}) }
    } catch (e) {
      return { ...b, gmail: { errore: messaggioErrore(e) } }
    }
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
  const gmail = b.canale === 'gmail'
  // Ceramex: si può inviare solo se la Gmail è collegata e la bozza c'è ancora lì.
  const senzaGmail = gmail && (b.gmail?.errore || !b.gmail?.bozza)
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
      const campiMail = { id, testo: campi.testo, a: lista(campi.a), cc: lista(campi.cc), oggetto: campi.oggetto }
      if (gmail) await chiama('gmail-bozza', { azione: 'invia', ...campiMail })
      else await chiama('invia-bozza', campiMail)
      avvisa(gmail ? 'Inviata dalla tua Gmail' : 'Inviata da info@')
      location.replace('#/bozze') // "indietro" non riporta alla bozza già mandata
    } catch (e) {
      avvisa(messaggioErrore(e))
      ricarica()
    } finally {
      setLavoro(false)
    }
  }

  // Anche scartare vuole due tocchi: non si torna indietro. Per Ceramex toglie anche la bozza da Gmail.
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
      if (gmail && !b.gmail?.errore) await chiama('gmail-bozza', { azione: 'scarta', id, testo: campi.testo })
      else chk(await sb.from('bozze').update({ stato: 'scartata', testo: campi.testo }).eq('id', id))
      avvisa('Scartata')
      location.replace('#/bozze')
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  const daTe = gmail && b.stato === 'da_imparare'
  return (
    <div className="schermata bozza">
      <Indietro titolo={b.aziende?.nome || b.posta?.da_nome || b.da_nome || 'Bozza'} />
      {b.stato === 'annullata' && <div className="scheda scheda-allarme"><p>Annullata: {b.motivo_annullata}</p></div>}
      {b.stato === 'inviata' && <p className="nota-piccola">Inviata {quando(b.inviata_il, true)}.</p>}
      {b.stato === 'scartata' && <p className="nota-piccola">Scartata.</p>}
      {b.errore && aperta && <div className="scheda scheda-allarme"><p>{b.errore}</p></div>}
      {gmail && aperta && b.gmail?.errore && <div className="scheda scheda-allarme"><p>{b.gmail.errore} Intanto puoi aprirla in Gmail.</p></div>}
      {gmail && aperta && !b.gmail?.errore && !b.gmail?.bozza && (
        <div className="scheda scheda-allarme"><p>La bozza non c'è più in Gmail: forse l'hai già mandata o cancellata da lì.</p></div>
      )}
      {gmail && aperta && b.gmail?.nuove > 0 && (
        <div className="scheda scheda-allarme"><p>Nella conversazione è arrivato qualcosa di nuovo: rileggila in Gmail prima di inviare.</p></div>
      )}
      {daTe && <p className="perche">L'agente non ha preparato la risposta: {b.perche?.motivo || 'gli mancava un dato certo'}{b.perche?.manca ? ` Manca: ${b.perche.manca}.` : ''}</p>}
      {!daTe && b.perche?.motivo && <p className="perche">{b.perche.motivo}</p>}

      {b.posta && <MailOriginale m={b.posta} />}
      {b.gmail?.originale && <MailOriginale m={b.gmail.originale} />}
      {gmail && b.gmail_thread_id && (
        <p><a className="tasto-piccolo" href={GMAIL_WEB + b.gmail_thread_id} target="_blank" rel="noreferrer">Apri in Gmail</a></p>
      )}

      {!daTe && (
        <>
          <div className="modulo">
            <label>A<input type="text" value={campi.a} onChange={cambia('a')} disabled={!aperta || senzaGmail} inputMode="email" /></label>
            <label>Cc<input type="text" value={campi.cc} onChange={cambia('cc')} disabled={!aperta || senzaGmail} inputMode="email" placeholder="nessuno" /></label>
            <label>Oggetto<input type="text" value={campi.oggetto} onChange={cambia('oggetto')} disabled={!aperta || senzaGmail} /></label>
          </div>
          <textarea className="testo-bozza" value={campi.testo} onChange={cambia('testo')} rows={8} disabled={!aperta || senzaGmail} />
        </>
      )}

      {aperta && (
        <div className="azioni azioni-bozza">
          {!senzaGmail && (
            <button type="button" className={'tasto-grande' + (conferma ? ' conferma' : '')} onClick={invia} disabled={lavoro}>
              {lavoro ? 'Invio…' : conferma ? 'Tocca ancora per inviare' : 'Approva e invia'}
            </button>
          )}
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
