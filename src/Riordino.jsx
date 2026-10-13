import { useEffect, useState } from 'react'
import { sb, quando } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Indietro, useModifiche } from './componenti'

// Riordino delle caselle (ok di Giovanni): info@ G&C dal 12.10.2026 sera (l'agente "Archiviazione email G&C" propone la
// cartella di Hostpoint per Posta in arrivo e Posta inviata) e Gmail Ceramex dal 12.10 notte (l'agente "Bozze mail Ceramex"
// propone l'etichetta per le conversazioni in Posta in arrivo). Qui Giovanni spunta quelle che vanno bene (o cambia la
// cartella) e preme "Sposta": la funzione riordino-mail le sposta subito. Niente si sposta senza questo tocco.
// "Tieni in vista" = l'agente non la ripropone più. Si vedono le caselle dell'area scelta (C, G o tutte e due).
// "Rispondi all'agente" (13.10.2026, info@ e dal pomeriggio anche Gmail Ceramex → agente 'ceramex'): Giovanni scrive cosa vuole ("mettila in AMARARE/ROMBACH", "crea la
// cartella DENIS sotto G&C"); parte una richiesta all'agente Archiviazione (richieste_agenti.riordino_id) con le istruzioni
// dentro, l'agente la fa partire subito e cambia solo la proposta. Le mail le sposta sempre Giovanni con "Sposta".

const CASELLE = [['gc', 'INBOX', 'Posta in arrivo info@'], ['gc', 'Sent', 'Posta inviata info@'], ['ceramex', 'INBOX', 'Gmail Ceramex']]
const corta = (c) => (c ? c.replace(/^Archive\//, '').replace(/^INBOX\/\d{4}\//, '') : '')
const caselleDi = (area) => (area === 'C' ? ['ceramex'] : area === 'G' ? ['gc'] : ['gc', 'ceramex'])
const nomeBreve = (da) => (da || '').replace(/\s*<[^>]+>\s*/, '').replace(/^"|"$/g, '') || da || ''
const IN_CORSO = ['nuova', 'avviata', 'in_corso']
// La prima riga della richiesta sono le parole di Giovanni: «…»
const paroleDi = (q) => (q.testo.split('\n')[0].match(/«(.*)»/) || [])[1] || q.testo

// Chi riceve la risposta: info@ → agente Archiviazione, Gmail Ceramex → agente Ceramex (giro delle ore piene).
const AGENTE_DI = { gc: 'archiviazione', ceramex: 'ceramex' }

function testoRichiesta(r, parole) {
  const oggi = new Date().toLocaleDateString('it-CH', { day: '2-digit', month: '2-digit' })
  if (r.casella === 'ceramex') {
    return [
      `«${parole}»`,
      `Riordino della Gmail Ceramex (PASSO 6): questa è la risposta di Giovanni (dall'app, ${oggi}) sulla conversazione «${r.oggetto || '(senza oggetto)'}» di ${r.da || '?'} del ${(r.data_email || '').slice(0, 10)}, in Posta in arrivo.`,
      `Riga: riordino_mail id = '${r.id}' (casella 'ceramex'). Etichetta proposta adesso: ${r.cartella_proposta || 'nessuna'}${r.nuova ? ' (nuova)' : ''}${r.dubbio ? `. Il tuo dubbio era: ${r.dubbio}` : ''}.`,
      'Cosa fare: capisci quale etichetta vuole Giovanni. Guarda le etichette esistenti (list_labels, solo quelle utente) e usa il nome esatto (es. INBOX/2025/Marazzi group). Un\'etichetta nuova va sotto INBOX/2025/… come le altre.',
      `Poi: update riordino_mail set cartella_proposta = '<etichetta>', nuova = <true se l'etichetta non esiste ancora, altrimenti false>, dubbio = null, motivo = 'Etichetta chiesta da Giovanni il ${oggi}: <riassunto in poche parole>', aggiornata_il = now() where id = '${r.id}' and casella = 'ceramex' and stato = 'proposta';`,
      'Fai lo stesso con le altre conversazioni in proposta dello stesso tipo, se ci sono, e dillo nella risposta. Nei giri dopo non cambiare più l\'etichetta delle righe con motivo "Etichetta chiesta da Giovanni…".',
      'Non cambiare etichette in Gmail e non archiviare niente: le sposta Giovanni con "Sposta" (un\'etichetta nuova si crea in quel momento). Se non capisci cosa vuole, non cambiare niente e nella risposta fagli una domanda precisa.',
      'Risposta: una frase con l\'etichetta scelta (scrivi "nuova" se non esiste ancora).',
    ].join('\n')
  }
  return [
    `«${parole}»`,
    `Riordino casella: questa è la risposta di Giovanni (dall'app, ${oggi}) sulla mail «${r.oggetto || '(senza oggetto)'}» di ${r.da || '?'} del ${(r.data_email || '').slice(0, 10)}, ora in ${r.cartella_da}.`,
    `Riga: riordino_mail id = '${r.id}'. Proposta attuale: ${r.cartella_proposta || 'nessuna'}${r.nuova ? ' (nuova)' : ''}${r.dubbio ? `. Il tuo dubbio era: ${r.dubbio}` : ''}.`,
    'Cosa fare: capisci quale cartella vuole Giovanni. Guarda l\'elenco delle cartelle (email-casella {"azione":"cartelle"}) e scrivi il percorso completo con il nome esatto, come le altre proposte (es. Archive/CLIENTI /AMINI/RÜSCHLIKON).',
    `Poi: update riordino_mail set cartella_proposta = '<percorso>', nuova = <true se la cartella non esiste ancora, altrimenti false>, dubbio = null, motivo = 'Cartella chiesta da Giovanni il ${oggi}: <riassunto in poche parole>', aggiornata_il = now() where id = '${r.id}' and stato = 'proposta';`,
    'Fai lo stesso con le altre mail in proposta dello stesso cliente e dello stesso riferimento, se ci sono, e dillo nella risposta. È una regola nuova: vale anche per le mail che arriveranno (passo R0).',
    'Non spostare mail e non creare cartelle: le sposta Giovanni con "Sposta" (una cartella nuova si crea in quel momento). Se non capisci cosa vuole, non cambiare niente e nella risposta fagli una domanda precisa.',
    'Risposta: una frase con la cartella scelta (scrivi "nuova" se non esiste ancora).',
  ].join('\n')
}

export function Riordino() {
  const { avvisa, area } = useApp()
  const [scelte, setScelte] = useState({})   // id → true
  const [cambi, setCambi] = useState({})     // id → cartella scelta da Giovanni
  const [aperta, setAperta] = useState(null) // riga con la scelta della cartella aperta
  const [cartelle, setCartelle] = useState({}) // casella → elenco
  const [conferma, setConferma] = useState(false)
  const [lavoro, setLavoro] = useState(false)
  const [risponde, setRisponde] = useState(null) // riga con il campo "Rispondi all'agente" aperto
  const [parole, setParole] = useState('')
  const quante = Object.values(scelte).filter(Boolean).length
  useModifiche(quante > 0 || Object.keys(cambi).length > 0 || !!parole.trim())

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [righe, spostate, risposte] = await Promise.all([
      sb.from('riordino_mail').select('*').in('casella', caselleDi(area)).in('stato', ['proposta', 'tenere']).order('data_email', { ascending: false }).then(chk),
      sb.from('riordino_mail').select('id,oggetto,da,cartella_finale,spostata_il').in('casella', caselleDi(area)).eq('stato', 'spostata')
        .gte('spostata_il', new Date(Date.now() - 86400e3).toISOString()).order('spostata_il', { ascending: false }).then(chk),
      sb.from('richieste_agenti').select('id,riordino_id,testo,stato,risposta,creata_il').not('riordino_id', 'is', null)
        .gte('creata_il', new Date(Date.now() - 7 * 86400e3).toISOString()).order('creata_il', { ascending: false }).then(chk),
    ])
    // L'ultima risposta di Giovanni per ogni mail.
    const ultima = {}
    for (const q of risposte) ultima[q.riordino_id] ||= q
    return { righe, spostate, ultima }
  }, [area])

  // Mentre l'agente lavora su una risposta, la schermata si rilegge ogni 20 secondi (per 15 minuti al massimo).
  const inAttesa = Object.values(dati?.ultima || {}).some((q) => IN_CORSO.includes(q.stato) && Date.now() - new Date(q.creata_il) < 15 * 60e3)
  useEffect(() => {
    if (!inAttesa) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') ricarica() }, 20000)
    return () => clearInterval(t)
  }, [inAttesa, ricarica])

  async function rispondi(r) {
    const t = parole.trim().replace(/\s+/g, ' ')
    if (!t) return avvisa('Scrivi cosa deve fare l\'agente')
    setLavoro(true)
    try {
      const casella = r.casella || 'gc'
      const q = chk(await sb.from('richieste_agenti').insert({ agente: AGENTE_DI[casella], testo: testoRichiesta({ ...r, casella }, t), riordino_id: r.id }).select('id').single())
      setParole('')
      setRisponde(null)
      setCambi((c) => { const n = { ...c }; delete n[r.id]; return n })
      segna([r.id], false)
      const esito = await chiama('agente-subito', { id: q.id }).catch(() => ({ ok: false }))
      avvisa(esito.ok ? 'Mandata: l\'agente cambia la proposta tra qualche minuto'
        : `Mandata: la fa al prossimo giro dell'agente (${casella === 'ceramex' ? 'ogni ora piena, 7–22' : 'ogni 2 ore, 8–18'})`)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  const cartellaDi = (r) => cambi[r.id] || r.cartella_proposta || ''
  const segna = (ids, si) => { setConferma(false); setScelte((s) => { const n = { ...s }; ids.forEach((id) => { n[id] = si }); return n }) }

  async function apriScelta(r) {
    setAperta(aperta === r.id ? null : r.id)
    const casella = r.casella || 'gc'
    if (cartelle[casella]) return
    try {
      const elenco = (await chiama('riordino-mail', { azione: 'cartelle', casella })).cartelle
      setCartelle((c) => ({ ...c, [casella]: elenco }))
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  async function sposta() {
    if (!conferma) { setConferma(true); return }
    setConferma(false)
    setLavoro(true)
    const voci = Object.keys(scelte).filter((id) => scelte[id]).map((id) => ({ id, ...(cambi[id] ? { cartella: cambi[id] } : {}) }))
    const tot = { spostate: 0, sparite: 0, errori: [] }
    try {
      for (let i = 0; i < voci.length; i += 50) {
        const r = await chiama('riordino-mail', { azione: 'sposta', voci: voci.slice(i, i + 50) })
        tot.spostate += r.spostate || 0
        tot.sparite += r.sparite || 0
        tot.errori.push(...(r.errori || []))
      }
      avvisa(tot.errori.length ? `Spostate ${tot.spostate}, ${tot.errori.length} non riuscite (vedi in rosso)`
        : `Spostate ${tot.spostate} mail${tot.sparite ? ` (${tot.sparite} non c'erano più)` : ''}`)
      setScelte({})
      setCambi({})
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
      ricarica()
    }
  }

  async function tieni() {
    const ids = Object.keys(scelte).filter((id) => scelte[id])
    try {
      chk(await sb.from('riordino_mail').update({ stato: 'tenere', aggiornata_il: new Date().toISOString() }).in('id', ids))
      avvisa(ids.length === 1 ? 'La tengo in vista: non te la ripropongo' : `Ne tengo in vista ${ids.length}: non te le ripropongo`)
      setScelte({})
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  // Righe e gruppi come funzioni semplici (non componenti): così la scelta della cartella non si richiude a ogni tocco.
  function riga(r) {
    const cartella = cartellaDi(r)
    const scelta = !!scelte[r.id]
    const q = dati.ultima[r.id]
    const lavora = q && IN_CORSO.includes(q.stato)
    const puoRispondere = r.stato === 'proposta' && !lavora
    return (
      <div key={r.id} className="voce-riordino">
        <div className={'riga riga-riordino' + (scelta ? ' scelta' : '')}>
          <button type="button" className="spunta-mail" aria-pressed={scelta} disabled={!cartella}
            aria-label={scelta ? 'Togli dalla scelta' : 'Scegli per spostarla'} onClick={() => segna([r.id], !scelta)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          </button>
          <span className="riga-corpo">
            <span className="riga-testo">{r.oggetto || '(senza oggetto)'}</span>
            <span className="riga-meta">
              {r.non_letta && <span title="Non letta">🔵 </span>}{r.stellina && <span title="Con la stellina">⭐ </span>}
              {r.cartella_da === 'Sent' ? 'a ' : ''}{nomeBreve(r.da)} · {quando(r.data_email, true)}{r.n_messaggi > 1 ? ` · ${r.n_messaggi} messaggi` : ''}
            </span>
            {/* Di cosa parla: il motivo scritto dall'agente (13.10.2026, uguale per info@ e Gmail Ceramex). */}
            {r.motivo && !r.dubbio && <span className="riga-meta motivo-riordino">{r.motivo}</span>}
            {r.dubbio && <span className="riga-meta dubbio">❓ {r.dubbio}</span>}
            {r.esito?.startsWith('Non spostata') && <span className="riga-meta rosso">{r.esito}</span>}
            {q && (
              <span className={'riga-meta risposta-agente' + (lavora ? ' attesa' : '')}>
                Tu: «{paroleDi(q)}»
                {lavora ? <> · l'agente ci sta lavorando…</> : q.risposta ? <><br />Agente: {q.risposta}</> : null}
              </span>
            )}
            <span className="tasti-riga">
              <button type="button" className="tasto-link cambia-cartella" onClick={() => apriScelta(r)}>
                {cambi[r.id] ? `Cambiata: ${corta(cambi[r.id])}` : cartella ? (r.casella === 'ceramex' ? 'Altra etichetta' : 'Altra cartella') : (r.casella === 'ceramex' ? "Scegli l'etichetta" : 'Scegli la cartella')}
              </button>
              {puoRispondere && (
                <button type="button" className="tasto-link cambia-cartella"
                  onClick={() => { setRisponde(risponde === r.id ? null : r.id); setParole(''); setAperta(null) }}>
                  {r.dubbio ? 'Rispondi all\'agente' : 'Scrivi all\'agente'}
                </button>
              )}
            </span>
          </span>
        </div>
        {aperta === r.id && (
          <SceltaCartella cartelle={cartelle[r.casella || 'gc']} attuale={cartella}
            onScegli={(c) => { setCambi((x) => ({ ...x, [r.id]: c })); segna([r.id], true); setAperta(null) }} />
        )}
        {risponde === r.id && (
          <div className="scelta-cartella rispondi-agente">
            <textarea rows={3} value={parole} onChange={(e) => setParole(e.target.value)} autoFocus
              placeholder="Es. no, mettila in AMARARE/ROMBACH · crea la cartella DENIS sotto G&C" />
            <div className="azioni">
              <button type="button" className="tasto-piccolo" onClick={() => rispondi(r)} disabled={lavoro || !parole.trim()}>Manda all'agente</button>
              <button type="button" className="tasto-link" onClick={() => { setRisponde(null); setParole('') }}>Annulla</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  function gruppi(righe) {
    const mappa = new Map()
    for (const r of righe) {
      const k = cartellaDi(r)
      if (!mappa.has(k)) mappa.set(k, [])
      mappa.get(k).push(r)
    }
    // Prima le cartelle con più mail; in fondo quelle da decidere.
    const ordine = [...mappa.entries()].sort((a, b) => (!a[0]) - (!b[0]) || b[1].length - a[1].length)
    return ordine.map(([cartella, rr]) => {
      const tutte = rr.every((r) => scelte[r.id])
      const nuova = rr.some((r) => r.nuova && !cambi[r.id])
      return (
        <section key={cartella || '-'} className="gruppo-riordino">
          <div className="gruppo-testa">
            <h3>{cartella ? corta(cartella) : 'Da decidere'}{nuova && <span className="nuova" title="Cartella nuova: si crea se la approvi"> ✚ nuova</span>}</h3>
            {cartella && <button type="button" className="tasto-link" onClick={() => segna(rr.map((r) => r.id), !tutte)}>
              {tutte ? 'Togli tutte' : rr.length === 1 ? 'Scegli' : `Scegli tutte (${rr.length})`}
            </button>}
          </div>
          <div className="elenco">{rr.map(riga)}</div>
        </section>
      )
    })
  }

  const proposte = dati?.righe.filter((r) => r.stato === 'proposta') || []
  const inVista = dati?.righe.filter((r) => r.stato === 'tenere') || []

  return (
    <div className="schermata riordino">
      <Indietro titolo="Riordino casella" />
      <p className="nota-piccola">
        Le mail ancora in Posta in arrivo (e Posta inviata di info@), con la cartella o l'etichetta proposta dall'agente.
        Scegli quelle che vanno bene e premi Sposta. Le altre restano dove sono.
      </p>
      <Stato carica={carica} errore={errore}
        vuoto={dati && !dati.righe.length && !dati.spostate.length ? 'Niente da riordinare: gli agenti propongono le mail nuove a ogni giro.' : null}>
        {dati && (
          <>
            {CASELLE.map(([casella, codice, titolo]) => {
              const rr = proposte.filter((r) => (r.casella || 'gc') === casella && r.cartella_da === codice)
              return rr.length > 0 && (
                <div key={casella + codice} className="casella">
                  <h2>{titolo} <span className="conto">{rr.length}</span></h2>
                  {gruppi(rr)}
                </div>
              )
            })}

            {/* Mail già archiviate che Giovanni ha chiesto di spostare (13.10.2026) */}
            {[...new Set(proposte.filter((r) => (r.casella || 'gc') === 'gc' && !['INBOX', 'Sent'].includes(r.cartella_da)).map((r) => r.cartella_da))].map((da) => {
              const rr = proposte.filter((r) => (r.casella || 'gc') === 'gc' && r.cartella_da === da)
              return (
                <div key={'gc' + da} className="casella">
                  <h2>Da {corta(da)} <span className="conto">{rr.length}</span></h2>
                  {gruppi(rr)}
                </div>
              )
            })}

            {inVista.length > 0 && (
              <div className="casella">
                <h2>In vista <span className="conto">{inVista.length}</span></h2>
                <p className="nota-piccola">Le hai tenute in Posta in arrivo: l'agente non le ripropone. Se vuoi spostarle, sceglile.</p>
                {gruppi(inVista)}
              </div>
            )}

            {dati.spostate.length > 0 && (
              <details className="spostate">
                <summary>Spostate nelle ultime 24 ore ({dati.spostate.length})</summary>
                <div className="elenco">
                  {dati.spostate.map((r) => (
                    <div key={r.id} className="riga">
                      <span className="riga-corpo">
                        <span className="riga-testo">{r.oggetto || '(senza oggetto)'}</span>
                        <span className="riga-meta">→ {corta(r.cartella_finale)} · {quando(r.spostata_il, true)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </Stato>

      {quante > 0 && (
        <div className="barra-riordino">
          <button type="button" className={'tasto-grande' + (conferma ? ' conferma' : '')} onClick={sposta} disabled={lavoro}>
            {lavoro ? 'Sposto…' : conferma ? `Tocca ancora: sposta ${quante} mail` : `Sposta ${quante} mail`}
          </button>
          <div className="azioni">
            <button type="button" className="tasto-link" onClick={tieni} disabled={lavoro}>Tieni in vista</button>
            <button type="button" className="tasto-link" onClick={() => { setScelte({}); setConferma(false) }} disabled={lavoro}>Annulla la scelta</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Le cartelle che esistono già nella casella (come le legge posta-gc). Cartelle nuove solo se le propone l'agente.
function SceltaCartella({ cartelle, attuale, onScegli }) {
  const [cerca, setCerca] = useState('')
  if (!cartelle) return <div className="scelta-cartella"><p className="msg">Carico le cartelle…</p></div>
  const parole = cerca.toLowerCase().split(/\s+/).filter(Boolean)
  const trovate = cartelle.filter((c) => parole.every((p) => c.toLowerCase().includes(p))).slice(0, 40)
  return (
    <div className="scelta-cartella">
      <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca la cartella (es. Cozza, O0214)" autoFocus />
      <div className="tendina">
        {trovate.map((c) => (
          <button key={c} type="button" className={c === attuale ? 'attuale' : ''} onClick={() => onScegli(c)}>{corta(c)}</button>
        ))}
        {!trovate.length && <p className="msg">Nessuna cartella con questo nome.</p>}
      </div>
    </div>
  )
}
