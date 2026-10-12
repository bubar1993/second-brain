import { useState } from 'react'
import { sb, quando } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Indietro, useModifiche } from './componenti'

// Riordino delle caselle (ok di Giovanni): info@ G&C dal 12.10.2026 sera (l'agente "Archiviazione email G&C" propone la
// cartella di Hostpoint per Posta in arrivo e Posta inviata) e Gmail Ceramex dal 12.10 notte (l'agente "Bozze mail Ceramex"
// propone l'etichetta per le conversazioni in Posta in arrivo). Qui Giovanni spunta quelle che vanno bene (o cambia la
// cartella) e preme "Sposta": la funzione riordino-mail le sposta subito. Niente si sposta senza questo tocco.
// "Tieni in vista" = l'agente non la ripropone più. Si vedono le caselle dell'area scelta (C, G o tutte e due).

const CASELLE = [['gc', 'INBOX', 'Posta in arrivo info@'], ['gc', 'Sent', 'Posta inviata info@'], ['ceramex', 'INBOX', 'Gmail Ceramex']]
const corta = (c) => (c ? c.replace(/^Archive\//, '').replace(/^INBOX\/\d{4}\//, '') : '')
const caselleDi = (area) => (area === 'C' ? ['ceramex'] : area === 'G' ? ['gc'] : ['gc', 'ceramex'])
const nomeBreve = (da) => (da || '').replace(/\s*<[^>]+>\s*/, '').replace(/^"|"$/g, '') || da || ''

export function Riordino() {
  const { avvisa, area } = useApp()
  const [scelte, setScelte] = useState({})   // id → true
  const [cambi, setCambi] = useState({})     // id → cartella scelta da Giovanni
  const [aperta, setAperta] = useState(null) // riga con la scelta della cartella aperta
  const [cartelle, setCartelle] = useState({}) // casella → elenco
  const [conferma, setConferma] = useState(false)
  const [lavoro, setLavoro] = useState(false)
  const quante = Object.values(scelte).filter(Boolean).length
  useModifiche(quante > 0 || Object.keys(cambi).length > 0)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [righe, spostate] = await Promise.all([
      sb.from('riordino_mail').select('*').in('casella', caselleDi(area)).in('stato', ['proposta', 'tenere']).order('data_email', { ascending: false }).then(chk),
      sb.from('riordino_mail').select('id,oggetto,da,cartella_finale,spostata_il').in('casella', caselleDi(area)).eq('stato', 'spostata')
        .gte('spostata_il', new Date(Date.now() - 86400e3).toISOString()).order('spostata_il', { ascending: false }).then(chk),
    ])
    return { righe, spostate }
  }, [area])

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
            {r.dubbio && <span className="riga-meta dubbio">❓ {r.dubbio}</span>}
            {r.esito?.startsWith('Non spostata') && <span className="riga-meta rosso">{r.esito}</span>}
            <button type="button" className="tasto-link cambia-cartella" onClick={() => apriScelta(r)}>
              {cambi[r.id] ? `Cambiata: ${corta(cambi[r.id])}` : cartella ? (r.casella === 'ceramex' ? 'Altra etichetta' : 'Altra cartella') : (r.casella === 'ceramex' ? "Scegli l'etichetta" : 'Scegli la cartella')}
            </button>
          </span>
        </div>
        {aperta === r.id && (
          <SceltaCartella cartelle={cartelle[r.casella || 'gc']} attuale={cartella}
            onScegli={(c) => { setCambi((x) => ({ ...x, [r.id]: c })); segna([r.id], true); setAperta(null) }} />
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
