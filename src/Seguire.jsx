import { useState } from 'react'
import { sb, areaDa, quando, giorniDaOggi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro } from './componenti'

// "Da seguire" (13.10.2026, Ceramex e G&C): promesse fatte e ricevute, campioni in giro, problemi fermi.
// Promesse e campioni li trova l'agente "Da seguire" nelle note; Giovanni spunta, cambia stato o toglie.
// I problemi fermi li calcola l'app: problemi aperti della stessa ditta e mandante senza novità da più di 7 giorni.

const GIORNI_FERMO = 7
const aree = (area) => (area === 'C' || area === 'G' ? [area] : ['C', 'G'])
const oggiISO = () => new Date().toLocaleDateString('sv-SE') // AAAA-MM-GG, ora di qui

// Ultima novità di un problema: la sua data, quando è stato scritto o quando Giovanni ha detto "ci sto lavorando".
const ultimaNovita = (n) => [n.data, n.creata_il, n.rivisto_il].filter(Boolean).map((x) => new Date(x.length === 10 ? `${x}T12:00` : x).getTime())
  .reduce((a, b) => Math.max(a, b), 0)

function problemiFermi(note) {
  const gruppi = new Map()
  for (const n of note) {
    const k = `${n.azienda_id || n.id}|${n.mandante || ''}`
    if (!gruppi.has(k)) gruppi.set(k, [])
    gruppi.get(k).push(n)
  }
  return [...gruppi.values()].map((g) => {
    g.sort((a, b) => ultimaNovita(b) - ultimaNovita(a))
    return { chiave: g[0].id, note: g, ultima: ultimaNovita(g[0]), primo: g[0] }
  }).filter((g) => Date.now() - g.ultima > GIORNI_FERMO * 86400000)
    .sort((a, b) => a.ultima - b.ultima)
}

const CAMPI_PROBLEMI = 'id,area,azienda_id,mandante,testo,data,creata_il,rivisto_il,aziende(id,nome)'
const problemiAperti = (area) => sb.from('note').select(CAMPI_PROBLEMI).in('area', aree(area)).eq('sezione', 'problemi')
  .is('risolto_il', null).is('eliminata_il', null).is('scartata_il', null).limit(500)

// Il numero per Oggi e Dentro: promesse scadute + problemi fermi.
export async function contaDaSeguire(area) {
  if (area === 'P') return 0
  const [p, n] = await Promise.all([
    sb.from('promesse').select('id', { count: 'exact', head: true }).in('area', aree(area))
      .is('fatta_il', null).is('scartata_il', null).lte('entro', oggiISO()),
    problemiAperti(area),
  ])
  return (p.count || 0) + problemiFermi(n.data || []).length
}

export function Seguire() {
  const { area, avvisa } = useApp()
  const [aperta, setAperta] = useState(null)
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    if (area === 'P') return null
    const settimana = new Date(Date.now() - 7 * 86400000).toISOString()
    const [promesse, campioni, problemi, chiuse] = await Promise.all([
      sb.from('promesse').select('id,area,chi,testo,entro,nota_id,mandante,aziende(id,nome)').in('area', aree(area))
        .is('fatta_il', null).is('scartata_il', null).order('entro', { ascending: true, nullsFirst: false }).order('creata_il'),
      sb.from('campioni').select('id,area,cosa,stato,mandante,richiesto_il,spedito_il,nota_id,aziende(id,nome)').in('area', aree(area))
        .in('stato', ['da_spedire', 'in_viaggio']).order('richiesto_il', { ascending: true, nullsFirst: false }),
      problemiAperti(area),
      sb.from('promesse').select('id,area,testo,chiusa_nota,fatta_il,aziende(id,nome)').in('area', aree(area))
        .eq('chiusa_da', 'agente').gte('fatta_il', settimana).order('fatta_il', { ascending: false }),
    ])
    return { promesse: chk(promesse), campioni: chk(campioni), fermi: problemiFermi(chk(problemi)), chiuse: chk(chiuse) }
  }, [area])

  // Ogni azione ha "Annulla" (rimette i valori di prima).
  async function cambia(tabella, ids, valori, prima, testo) {
    try {
      chk(await sb.from(tabella).update(valori).in('id', ids))
      avvisa(testo, { etichetta: 'Annulla', fai: async () => {
        try { chk(await sb.from(tabella).update(prima).in('id', ids)); ricarica() } catch (e) { avvisa(messaggioErrore(e)) }
      } })
      setAperta(null)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  if (area === 'P') {
    return (
      <div className="schermata">
        <Indietro titolo="Da seguire" />
        <p className="msg">Da seguire è per Ceramex e G&C: scegli una delle due aree in alto.</p>
      </div>
    )
  }

  const io = dati?.promesse.filter((p) => p.chi === 'io') || []
  const altri = dati?.promesse.filter((p) => p.chi === 'altri') || []
  const daSpedire = dati?.campioni.filter((c) => c.stato === 'da_spedire') || []
  const inViaggio = dati?.campioni.filter((c) => c.stato === 'in_viaggio') || []
  const vuoto = dati && !dati.promesse.length && !dati.campioni.length && !dati.fermi.length
  const ditta = (x) => x.aziende?.nome
  const colore = (x) => ({ '--col': areaDa(x.area)?.colore || 'var(--grigio)' })

  const rigaPromessa = (p) => {
    const giorni = p.entro ? giorniDaOggi(p.entro) : null
    const quandoEntro = giorni === null ? null : giorni < 0 ? `scaduta ${quando(p.entro)}` : `entro ${quando(p.entro)}`
    const apri = aperta === p.id
    return (
      <div key={p.id} className="voce-promemoria">
        <div>
          <div className="riga riga-promemoria" style={colore(p)}>
            <button type="button" className="spunta" aria-label={`Fatta: ${p.testo}`}
              onClick={() => cambia('promesse', [p.id], { fatta_il: new Date().toISOString(), chiusa_da: 'giovanni' }, { fatta_il: null, chiusa_da: null }, 'Fatta')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </button>
            <button type="button" className="riga-corpo riga-tocca" onClick={() => setAperta(apri ? null : p.id)} aria-expanded={apri}>
              <span className="riga-testo">{p.testo}</span>
              <span className="riga-meta">
                {[ditta(p), p.mandante && p.mandante !== 'Altro' ? p.mandante : null].filter(Boolean).join(' · ')}
                {quandoEntro && <>{ditta(p) || p.mandante ? ' · ' : ''}<span className={giorni <= 0 ? 'rosso' : ''}>{quandoEntro}</span></>}
              </span>
            </button>
          </div>
          {apri && (
            <div className="modifica-promemoria">
              <div className="azioni">
                {p.nota_id && <a className="tasto-piccolo" href={`#/nota/${p.nota_id}`}>Apri la nota</a>}
                {p.aziende && <a className="tasto-piccolo" href={`#/azienda/${p.aziende.id}`}>Scheda</a>}
                <button type="button" className="tasto-link pericolo"
                  onClick={() => cambia('promesse', [p.id], { scartata_il: new Date().toISOString() }, { scartata_il: null }, 'Tolta')}>Non serve</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const rigaCampione = (c) => {
    const apri = aperta === c.id
    const avanti = c.stato === 'da_spedire'
      ? ['Spedito', { stato: 'in_viaggio', spedito_il: oggiISO(), cambiato_da: 'giovanni' }, 'Segnato: in viaggio']
      : ['Arrivato', { stato: 'arrivato', arrivato_il: oggiISO(), cambiato_da: 'giovanni' }, 'Segnato: arrivato']
    const prima = { stato: c.stato, spedito_il: c.spedito_il, arrivato_il: null, cambiato_da: null }
    const data = c.stato === 'da_spedire' ? (c.richiesto_il && `chiesti ${quando(c.richiesto_il)}`) : (c.spedito_il && `spediti ${quando(c.spedito_il)}`)
    return (
      <div key={c.id} className="voce-promemoria">
        <div>
          <div className="riga" style={colore(c)}>
            <span className="pallino" style={{ background: 'var(--col)' }} />
            <button type="button" className="riga-corpo riga-tocca" onClick={() => setAperta(apri ? null : c.id)} aria-expanded={apri}>
              <span className="riga-testo">{c.cosa}</span>
              <span className="riga-meta">{[ditta(c), c.mandante && c.mandante !== 'Altro' ? c.mandante : null, data].filter(Boolean).join(' · ')}</span>
            </button>
            <button type="button" className="tasto-piccolo" onClick={() => cambia('campioni', [c.id], avanti[1], prima, avanti[2])}>{avanti[0]}</button>
          </div>
          {apri && (
            <div className="modifica-promemoria">
              <div className="azioni">
                {c.nota_id && <a className="tasto-piccolo" href={`#/nota/${c.nota_id}`}>Apri la nota</a>}
                {c.aziende && <a className="tasto-piccolo" href={`#/azienda/${c.aziende.id}`}>Scheda</a>}
                <button type="button" className="tasto-link pericolo"
                  onClick={() => cambia('campioni', [c.id], { stato: 'annullato', cambiato_da: 'giovanni' }, prima, 'Campione tolto')}>Non serve più</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const rigaFermo = (g) => {
    const n = g.primo
    const ids = g.note.map((x) => x.id)
    const giorni = Math.floor((Date.now() - g.ultima) / 86400000)
    return (
      <div key={g.chiave} className="riga riga-fermo" style={colore(n)}>
        <span className="pallino" style={{ background: 'var(--col)' }} />
        <a className="riga-corpo" href={n.aziende ? `#/azienda/${n.aziende.id}` : `#/nota/${n.id}`}>
          <span className="riga-testo"><strong>{[ditta(n), n.mandante && n.mandante !== 'Altro' ? n.mandante : null].filter(Boolean).join(' · ') || 'Problema'}</strong>: {n.testo}</span>
          <span className="riga-meta">fermo da {giorni} giorni{g.note.length > 1 ? ` · ${g.note.length} note aperte` : ''}</span>
        </a>
        <div className="azioni-fermo">
          <button type="button" className="tasto-piccolo" onClick={() => cambia('note', ids, { risolto_il: new Date().toISOString() }, { risolto_il: null }, 'Risolto')}>Risolto</button>
          <button type="button" className="tasto-link" onClick={() => cambia('note', ids, { rivisto_il: new Date().toISOString() },
            { rivisto_il: n.rivisto_il ?? null }, 'Ok: te lo ricordo tra 7 giorni')}>Ci lavoro: ricordamelo tra 7 giorni</button>
        </div>
      </div>
    )
  }

  return (
    <div className="schermata">
      <Indietro titolo="Da seguire" />
      <Stato carica={carica} errore={errore} vuoto={vuoto ? 'Niente da seguire: nessuna promessa aperta, nessun campione in giro, nessun problema fermo.' : null}>
        {dati && (
          <>
            {io.length > 0 && <><h2>Ho promesso io</h2><div className="elenco">{io.map(rigaPromessa)}</div></>}
            {altri.length > 0 && <><h2>Mi hanno promesso</h2><div className="elenco">{altri.map(rigaPromessa)}</div></>}
            {daSpedire.length > 0 && <><h2>Campioni da spedire</h2><div className="elenco">{daSpedire.map(rigaCampione)}</div></>}
            {inViaggio.length > 0 && <><h2>Campioni in viaggio</h2><div className="elenco">{inViaggio.map(rigaCampione)}</div></>}
            {dati.fermi.length > 0 && (
              <>
                <h2>Problemi fermi</h2>
                <p className="nota-piccola">Problemi aperti senza novità da più di {GIORNI_FERMO} giorni.</p>
                <div className="elenco">{dati.fermi.map(rigaFermo)}</div>
              </>
            )}
            {dati.chiuse.length > 0 && (
              <>
                <h2>Chiuse dall'agente</h2>
                <p className="nota-piccola">Promesse che l'agente ha visto mantenute negli ultimi 7 giorni. Se non è vero, riaprile.</p>
                <div className="elenco">
                  {dati.chiuse.map((p) => (
                    <div key={p.id} className="riga" style={colore(p)}>
                      <span className="riga-corpo">
                        <span className="riga-testo">{p.testo}</span>
                        <span className="riga-meta">{[ditta(p), p.chiusa_nota].filter(Boolean).join(' · ')}</span>
                      </span>
                      <button type="button" className="tasto-piccolo"
                        onClick={() => cambia('promesse', [p.id], { fatta_il: null, chiusa_da: null, chiusa_nota: null },
                          { fatta_il: p.fatta_il, chiusa_da: 'agente', chiusa_nota: p.chiusa_nota }, 'Riaperta')}>Riapri</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Stato>
    </div>
  )
}
