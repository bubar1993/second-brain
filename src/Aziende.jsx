import { useState } from 'react'
import { sb, areaDa, quando } from './supabase'
import { useApp, useCarica, chk, Stato, Indietro } from './componenti'

export const SEZIONI = [
  ['problemi', 'Problemi'], ['campionature', 'Campionature'], ['offerte', 'Offerte'],
  ['ordini', 'Ordini'], ['accordi', 'Accordi'], ['comunicazioni', 'Comunicazioni'],
]
const nomeSezione = Object.fromEntries(SEZIONI)

// Legge tutte le righe anche oltre il limite di 1000 per richiesta.
async function tutte(crea) {
  const righe = []
  for (let da = 0; ; da += 1000) {
    const pezzo = chk(await crea().range(da, da + 999))
    righe.push(...pezzo)
    if (pezzo.length < 1000) return righe
  }
}

// Elenco schede: prima le aziende con le note più recenti.
export function Aziende() {
  const { area } = useApp()
  const [cerca, setCerca] = useState('')

  const { dati, errore, carica } = useCarica(async () => {
    let qa = sb.from('aziende').select('id,nome,area,gruppo_id').is('eliminata_il', null).is('unito_in', null)
    if (area !== 'T') qa = qa.eq('area', area)
    const [aziende, note] = await Promise.all([
      qa.then(chk),
      tutte(() => sb.from('note').select('azienda_id,sezione,data,risolto_il')
        .not('azienda_id', 'is', null).is('eliminata_il', null).is('scartata_il', null).order('id')),
    ])
    const info = {}
    for (const n of note) {
      const i = (info[n.azienda_id] ||= { note: 0, problemi: 0, ultima: '' })
      i.note++
      if (n.sezione === 'problemi' && !n.risolto_il) i.problemi++
      if (n.data > i.ultima) i.ultima = n.data
    }
    return aziende.map((a) => ({ ...a, ...(info[a.id] || { note: 0, problemi: 0, ultima: '' }) }))
      .sort((a, b) => b.ultima.localeCompare(a.ultima) || a.nome.localeCompare(b.nome))
  }, [area])

  const testo = cerca.trim().toLowerCase()
  const visibili = (dati || []).filter((a) => !testo || a.nome.toLowerCase().includes(testo))

  return (
    <div className="schermata">
      <Indietro titolo="Aziende" />
      <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca un'azienda" />
      <Stato carica={carica} errore={errore} vuoto={dati && !visibili.length ? 'Nessuna azienda qui.' : null}>
        {dati && (
          <div className="elenco">
            {visibili.map((a) => (
              <a key={a.id} className="riga" href={`#/azienda/${a.id}`}>
                <span className="pallino" style={{ background: areaDa(a.area).colore }} />
                <span className="riga-corpo">
                  <span className="riga-testo">{a.nome}</span>
                  <span className="riga-meta">
                    {a.note} note
                    {a.problemi > 0 && <> · <span className="rosso">{a.problemi} {a.problemi === 1 ? 'problema aperto' : 'problemi aperti'}</span></>}
                    {a.ultima && ` · ultima ${quando(a.ultima)}`}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
      </Stato>
    </div>
  )
}

// Scheda azienda: contatti, filiali e note per mandante e sezione.
export function Azienda({ id }) {
  const [mandante, setMandante] = useState(null)
  const [risolte, setRisolte] = useState(false)

  const { dati, errore, carica } = useCarica(async () => {
    const [a, filiali, note] = await Promise.all([
      sb.from('aziende').select('*,gruppo:gruppo_id(id,nome)').eq('id', id).single().then(chk),
      sb.from('aziende').select('id,nome').eq('gruppo_id', id).is('eliminata_il', null).order('nome').then(chk),
      sb.from('note').select('id,testo,mandante,sezione,data,contatto,risolto_il').eq('azienda_id', id)
        .is('eliminata_il', null).is('scartata_il', null)
        .order('data', { ascending: false }).order('creata_il', { ascending: false }).then(chk),
    ])
    return { a, filiali, note }
  }, [id])

  if (!dati) {
    return <div className="schermata"><Indietro titolo="Azienda" /><Stato carica={carica} errore={errore} /></div>
  }

  const { a, filiali, note } = dati
  const mandanti = [...new Set(note.map((n) => n.mandante).filter(Boolean))]
  const filtrate = note.filter((n) => (!mandante || n.mandante === mandante) && (risolte || !n.risolto_il))
  const nascoste = note.filter((n) => (!mandante || n.mandante === mandante) && n.risolto_il).length

  return (
    <div className="schermata">
      <Indietro titolo={a.nome} />
      {a.ragione_sociale && a.ragione_sociale !== a.nome && <p className="nota-piccola">{a.ragione_sociale}</p>}
      {a.gruppo && <p className="nota-piccola">Fa parte di <a href={`#/azienda/${a.gruppo.id}`}>{a.gruppo.nome}</a></p>}
      {filiali.length > 0 && (
        <p className="nota-piccola">
          Filiali: {filiali.map((f, i) => <span key={f.id}>{i > 0 && ', '}<a href={`#/azienda/${f.id}`}>{f.nome}</a></span>)}
        </p>
      )}

      {a.contatti.length > 0 && (
        <details className="contatti">
          <summary>Contatti ({a.contatti.length})</summary>
          <div className="elenco">
            {a.contatti.map((c, i) => (
              <div key={i} className="riga">
                <span className="riga-corpo">
                  <span className="riga-testo">{c.nome || c.email}</span>
                  {c.ruolo && <span className="riga-meta">{c.ruolo}</span>}
                </span>
                {c.email && <a className="tasto-piccolo" href={`mailto:${c.email}`}>Scrivi</a>}
              </div>
            ))}
          </div>
        </details>
      )}

      {mandanti.length > 1 && (
        <div className="chips">
          <button type="button" className={'chip' + (!mandante ? ' attivo' : '')} onClick={() => setMandante(null)}>Tutti</button>
          {mandanti.map((m) => (
            <button key={m} type="button" className={'chip' + (mandante === m ? ' attivo' : '')} onClick={() => setMandante(m)}>{m}</button>
          ))}
        </div>
      )}

      {!filtrate.length && <p className="msg">Nessuna nota aperta.</p>}
      {SEZIONI.map(([sez, titolo]) => {
        const righe = filtrate.filter((n) => n.sezione === sez)
        if (!righe.length) return null
        return (
          <section key={sez} className="sezione">
            <h3 className={sez === 'problemi' ? 'rosso' : ''}>{titolo} ({righe.length})</h3>
            <div className="elenco">
              {righe.map((n) => (
                <a key={n.id} className="riga" href={`#/nota/${n.id}`}>
                  <span className="riga-corpo">
                    <span className={'riga-testo' + (n.risolto_il ? ' barrato' : '')}>{n.testo}</span>
                    <span className="riga-meta">
                      {quando(n.data)}
                      {!mandante && n.mandante && ` · ${n.mandante}`}
                      {n.contatto && ` · ${n.contatto}`}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        )
      })}

      {nascoste > 0 && (
        <button type="button" className="tasto-link" onClick={() => setRisolte(!risolte)}>
          {risolte ? 'Nascondi le risolte' : `Mostra anche le risolte (${nascoste})`}
        </button>
      )}
    </div>
  )
}

export { nomeSezione }
