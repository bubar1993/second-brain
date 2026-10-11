import { useEffect, useState } from 'react'
import { sb, AREE, areaDa, nomePersona } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, NotaRiga, Stato, Indietro } from './componenti'

// Diagramma a cerchi: chi sta in più aree sta nell'intersezione.
const CERCHI = { C: [115, 105], G: [185, 105], P: [150, 165] }
const RAGGIO = 80
const POSIZIONI = {
  C: [85, 88], G: [215, 88], P: [150, 212],
  CG: [150, 78], CP: [108, 152], GP: [192, 152], CGP: [150, 126],
}
const NOMI_CERCHI = { C: [62, 16], G: [238, 16], P: [150, 266] }

const chiaveDi = (aree) => ['C', 'G', 'P'].filter((c) => aree.includes(c)).join('')
const nomeChiave = (k) => (k ? k.split('').map((c) => areaDa(c).nome).join(' + ') : 'Senza area')

function Diagramma({ conteggi, scelta, onScelta }) {
  function tocca(e) {
    const svg = e.currentTarget
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    const k = ['C', 'G', 'P'].filter((c) => Math.hypot(p.x - CERCHI[c][0], p.y - CERCHI[c][1]) <= RAGGIO).join('')
    onScelta(k && k !== scelta ? k : null)
  }
  return (
    <svg className="diagramma" viewBox="0 0 300 280" onClick={tocca} role="img"
      aria-label="Persone per area: tocca una zona per filtrare">
      {AREE.map((a) => (
        <circle key={a.codice} cx={CERCHI[a.codice][0]} cy={CERCHI[a.codice][1]} r={RAGGIO}
          fill={a.colore} fillOpacity={scelta && !scelta.includes(a.codice) ? 0.05 : 0.16}
          stroke={a.colore} strokeWidth="2" />
      ))}
      {AREE.map((a) => (
        <text key={a.codice} x={NOMI_CERCHI[a.codice][0]} y={NOMI_CERCHI[a.codice][1]}
          className="nome-cerchio" fill={a.colore} textAnchor="middle" dominantBaseline="middle">
          {a.nome}
        </text>
      ))}
      {Object.entries(POSIZIONI).map(([k, [x, y]]) => (
        <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
          className={'conteggio' + (scelta === k ? ' scelto' : '')}>
          {conteggi[k] || 0}
        </text>
      ))}
    </svg>
  )
}

export function Persone() {
  const { area, avvisa, vai } = useApp()
  const [scelta, setScelta] = useState(null)
  const [cerca, setCerca] = useState('')

  const { dati, errore, carica } = useCarica(async () => chk(
    await sb.from('persone').select('id,nome,cognome,persone_aree(area)')
      .is('eliminata_il', null).order('nome').order('cognome'),
  ), [])

  const conteggi = {}
  const tutte = (dati || []).map((p) => {
    const k = chiaveDi(p.persone_aree.map((x) => x.area))
    conteggi[k] = (conteggi[k] || 0) + 1
    return { ...p, chiave: k }
  })

  const testo = cerca.trim().toLowerCase()
  const visibili = tutte.filter((p) =>
    (scelta === null || p.chiave === scelta) &&
    (area === 'T' || p.chiave.includes(area)) &&
    (!testo || nomePersona(p).toLowerCase().includes(testo)))

  async function crea() {
    const parti = cerca.trim().split(/\s+/)
    const nome = parti.shift()
    try {
      const p = chk(await sb.from('persone').insert({ nome, cognome: parti.join(' ') || null }).select('id').single())
      if (area !== 'T') chk(await sb.from('persone_aree').insert({ persona_id: p.id, area }))
      vai(`/persona/${p.id}`)
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  return (
    <div className="schermata">
      <Indietro titolo="Persone" />
      <Diagramma conteggi={conteggi} scelta={scelta} onScelta={setScelta} />
      {conteggi[''] > 0 && (
        <button type="button" className={'chip' + (scelta === '' ? ' attivo' : '')}
          onClick={() => setScelta(scelta === '' ? null : '')}>
          Senza area: {conteggi['']}
        </button>
      )}

      <input type="search" className="cerca-persone" value={cerca} onChange={(e) => setCerca(e.target.value)}
        placeholder="Cerca o aggiungi una persona" />

      {scelta !== null && (
        <p className="filtro">
          {nomeChiave(scelta)}
          <button type="button" className="tasto-link" onClick={() => setScelta(null)}>Mostra tutte</button>
        </p>
      )}

      <Stato carica={carica} errore={errore}>
        {dati && (
          <div className="elenco">
            {visibili.map((p) => (
              <a key={p.id} className="riga" href={`#/persona/${p.id}`}>
                <span className="pallini">
                  {p.chiave.split('').map((c) => (
                    <span key={c} className="pallino" style={{ background: areaDa(c).colore }} />
                  ))}
                </span>
                <span className="riga-corpo"><span className="riga-testo">{nomePersona(p)}</span></span>
              </a>
            ))}
            {testo && (
              <button type="button" className="riga crea" onClick={crea}>+ Nuova persona «{cerca.trim()}»</button>
            )}
            {!visibili.length && !testo && <p className="msg">Nessuna persona qui.</p>}
          </div>
        )}
      </Stato>
    </div>
  )
}

export function Persona({ id }) {
  const { area, avvisa, vai } = useApp()
  const [modulo, setModulo] = useState(null)
  const [modificato, setModificato] = useState(false)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [p, np] = await Promise.all([
      sb.from('persone').select('*,persone_aree(area)').eq('id', id).single(),
      sb.from('note_persone').select('note(id,area,testo,fonte,creata_il,eliminata_il,allegati(id))').eq('persona_id', id),
    ])
    const note = chk(np).map((x) => x.note).filter((n) => n && !n.eliminata_il)
      .sort((a, b) => b.creata_il.localeCompare(a.creata_il))
    return { p: chk(p), note }
  }, [id])

  useEffect(() => {
    if (!dati || modulo) return
    const { nome, cognome, telefono, email, compleanno } = dati.p
    setModulo({ nome: nome || '', cognome: cognome || '', telefono: telefono || '', email: email || '', compleanno: compleanno || '' })
  }, [dati, modulo])

  const campo = (k) => ({
    value: modulo[k],
    onChange: (e) => { setModulo({ ...modulo, [k]: e.target.value }); setModificato(true) },
  })

  async function salva() {
    if (!modulo.nome.trim()) return avvisa('Il nome serve')
    try {
      chk(await sb.from('persone').update({
        nome: modulo.nome.trim(),
        cognome: modulo.cognome.trim() || null,
        telefono: modulo.telefono.trim() || null,
        email: modulo.email.trim() || null,
        compleanno: modulo.compleanno || null,
      }).eq('id', id))
      setModificato(false)
      avvisa('Salvato')
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  async function cambiaArea(codice, ha) {
    try {
      if (ha) chk(await sb.from('persone_aree').delete().eq('persona_id', id).eq('area', codice))
      else chk(await sb.from('persone_aree').insert({ persona_id: id, area: codice }))
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  async function elimina() {
    if (!confirm('Mettere questa persona nel cestino?')) return
    try {
      chk(await sb.from('persone').update({ eliminata_il: new Date().toISOString() }).eq('id', id))
      avvisa('Nel cestino')
      history.back()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  if (!dati || !modulo) {
    return <div className="schermata"><Indietro titolo="Persona" /><Stato carica={carica} errore={errore} /></div>
  }

  const aree = dati.p.persone_aree.map((x) => x.area)
  // Le note restano nella loro area: con un'area scelta si vedono solo quelle.
  const note = area === 'T' ? dati.note : dati.note.filter((n) => n.area === area)

  return (
    <div className="schermata">
      <Indietro titolo={nomePersona(dati.p)} />

      <div className="scelta-area">
        {AREE.map((a) => {
          const ha = aree.includes(a.codice)
          return (
            <button key={a.codice} type="button" style={{ '--c': a.colore }}
              className={'chip chip-area' + (ha ? ' attivo' : '')} aria-pressed={ha}
              onClick={() => cambiaArea(a.codice, ha)}>
              {a.nome}
            </button>
          )
        })}
      </div>

      <div className="modulo">
        <div className="due">
          <label>Nome<input {...campo('nome')} /></label>
          <label>Cognome<input {...campo('cognome')} /></label>
        </div>
        <label>Telefono<input type="tel" inputMode="tel" {...campo('telefono')} /></label>
        <label>Email<input type="email" inputMode="email" {...campo('email')} /></label>
        <label>Compleanno<input type="date" {...campo('compleanno')} /></label>
        {modificato && <button type="button" className="tasto-grande" onClick={salva}>Salva</button>}
      </div>

      <div className="azioni">
        {dati.p.telefono && <a className="tasto-piccolo" href={`tel:${dati.p.telefono}`}>Chiama</a>}
        {dati.p.email && <a className="tasto-piccolo" href={`mailto:${dati.p.email}`}>Scrivi</a>}
        <button type="button" className="tasto-piccolo" onClick={() => vai(`/aggiungi?persona=${id}`)}>+ Nota</button>
      </div>

      <h2>Note{area !== 'T' ? ` ${areaDa(area).nome}` : ''}</h2>
      {note.length ? (
        <div className="elenco">{note.map((n) => <NotaRiga key={n.id} nota={n} />)}</div>
      ) : (
        <p className="msg">Nessuna nota{area !== 'T' ? ' in quest\'area' : ''}.</p>
      )}

      <button type="button" className="tasto-link pericolo" onClick={elimina}>Metti nel cestino</button>
    </div>
  )
}
