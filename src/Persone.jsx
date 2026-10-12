import { useEffect, useState } from 'react'
import { sb, AREE, areaDa, nomePersona, quando, CAMPI_PERSONA, etichettePersona, numeroWhatsApp, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro, EtichettePersona, Icona } from './componenti'
import { nomeSezione } from './Aziende'

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
const areeDi = (p) => [...new Set([...p.persone_aree.map((x) => x.area),
  ...p.persone_aziende.map((x) => x.aziende?.area).filter(Boolean)])]

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
    await sb.from('persone').select(CAMPI_PERSONA + ',email,ruolo')
      .is('eliminata_il', null).order('nome').order('cognome'),
  ), [])

  const conteggi = {}
  const tutte = (dati || []).map((p) => {
    const k = chiaveDi(areeDi(p))
    conteggi[k] = (conteggi[k] || 0) + 1
    return { ...p, chiave: k, cercabile: [nomePersona(p), p.email, p.ruolo, ...etichettePersona(p).map((e) => e.testo)].join(' ').toLowerCase() }
  })

  const parole = cerca.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visibili = tutte.filter((p) =>
    (scelta === null || p.chiave === scelta) &&
    (area === 'T' || p.chiave.includes(area)) &&
    parole.every((w) => p.cercabile.includes(w)))

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
        placeholder="Cerca persona, ditta o email" />

      {scelta !== null && (
        <p className="filtro">
          {nomeChiave(scelta)}
          <button type="button" className="tasto-link" onClick={() => setScelta(null)}>Mostra tutte</button>
        </p>
      )}

      <Stato carica={carica} errore={errore}>
        {dati && (
          <div className="elenco">
            {visibili.slice(0, 200).map((p) => (
              <a key={p.id} className="riga" href={`#/persona/${p.id}`}>
                <span className="pallini">
                  {p.chiave.split('').map((c) => (
                    <span key={c} className="pallino" style={{ background: areaDa(c).colore }} />
                  ))}
                </span>
                <span className="riga-corpo">
                  <span className="riga-testo">{nomePersona(p)}</span>
                  <span className="riga-meta"><EtichettePersona p={p} /></span>
                </span>
              </a>
            ))}
            {visibili.length > 200 && <p className="msg">Altre {visibili.length - 200}: scrivi un nome per trovarle.</p>}
            {cerca.trim() && (
              <button type="button" className="riga crea" onClick={crea}>+ Nuova persona «{cerca.trim()}»</button>
            )}
            {!visibili.length && !cerca.trim() && <p className="msg">Nessuna persona qui.</p>}
          </div>
        )}
      </Stato>
    </div>
  )
}

// Le voci del riassunto scritto dagli agenti, nell'ordine in cui servono prima di un incontro.
const VOCI_RIASSUNTO = [
  ['da_chiedere', 'Da chiedere'],
  ['cose_aperte', 'Cose aperte'],
  ['ultimo_incontro', 'Ultimo contatto'],
  ['chi_e', 'Chi è'],
  ['consigli', 'Come parlarle'],
]

// Scheda persona: chi è, contatti, riassunto degli agenti, promemoria, note, mail e WhatsApp.
// Le cose restano nella loro area: con un'area scelta in alto si vede solo quella.
export function Persona({ id }) {
  const { area, avvisa, vai } = useApp()
  const [modulo, setModulo] = useState(null)
  const [modificato, setModificato] = useState(false)
  const [aperto, setAperto] = useState(false)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const p = chk(await sb.from('persone').select('*,' + CAMPI_PERSONA.replace('id,nome,cognome,', '')).eq('id', id).single())
    const indirizzi = [p.email, ...(p.email_altre || [])].filter(Boolean).map((e) => e.toLowerCase())
    const ditte = p.persone_aziende.map((x) => x.aziende?.id).filter(Boolean)
    const ieri = new Date(Date.now() - 86400000).toISOString()
    const [np, riassunti, wa, posta, ev] = await Promise.all([
      sb.from('note_persone').select('note(id,area,testo,fonte,data,creata_il,eliminata_il,scartata_il,sezione,mandante,risolto_il,azienda_id,aziende(id,nome),promemoria(id,testo,scade_il,fatto_il,eliminata_il))').eq('persona_id', id),
      sb.from('persone_riassunti').select('*').eq('persona_id', id),
      sb.from('wa_contatti').select('wa_id,area,wa_messaggi(id,direzione,testo,tipo,data)').eq('persona_id', id)
        .order('data', { referencedTable: 'wa_messaggi', ascending: false }).limit(20, { referencedTable: 'wa_messaggi' }),
      indirizzi.length
        ? sb.from('posta').select('id,area,message_id,da,da_nome,oggetto,data,cartella')
          .or(indirizzi.flatMap((e) => [`da.ilike.${e}`, `a.cs.{${e}}`]).join(','))
          .order('data', { ascending: false }).limit(15)
        : Promise.resolve({ data: [] }),
      sb.from('eventi').select('id,titolo,inizio,tutto_il_giorno,luogo,area,stato')
        .or([`persona_id.eq.${id}`, ...(ditte.length ? [`azienda_id.in.(${ditte.join(',')})`] : [])].join(','))
        .in('stato', ['confermato', 'da_creare', 'proposto']).gte('inizio', ieri).order('inizio').limit(5),
    ])
    const note = chk(np).map((x) => x.note).filter((n) => n && !n.eliminata_il && !n.scartata_il)
      .sort((a, b) => (b.data || b.creata_il).localeCompare(a.data || a.creata_il))
    const messaggi = chk(wa).flatMap((c) => c.wa_messaggi.map((m) => ({ ...m, area: c.area })))
      .sort((a, b) => b.data.localeCompare(a.data))
    return { p, note, riassunti: chk(riassunti), messaggi, posta: chk(posta), chat: chk(wa).map((c) => c.wa_id), eventi: chk(ev) }
  }, [id])

  useEffect(() => {
    if (!dati || modulo) return
    const { nome, cognome, telefono, email, compleanno, ruolo } = dati.p
    setModulo({ nome: nome || '', cognome: cognome || '', telefono: telefono || '', email: email || '', compleanno: compleanno || '', ruolo: ruolo || '' })
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
        ruolo: modulo.ruolo.trim() || null,
      }).eq('id', id))
      setModificato(false)
      avvisa('Salvato')
      ricarica()
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

  const { p } = dati
  const nell = (x) => area === 'T' || x.area === area
  const aree = p.persone_aree.map((x) => x.area)
  const ditte = p.persone_aziende.filter((x) => x.aziende && nell(x.aziende))
  const riassunti = dati.riassunti.filter(nell).sort((a, b) => 'CGP'.indexOf(a.area) - 'CGP'.indexOf(b.area))
  const note = dati.note.filter(nell)
  const promemoria = note.flatMap((n) => (n.promemoria || []).filter((x) => !x.fatto_il && !x.eliminata_il)
    .map((x) => ({ ...x, area: n.area, nota_id: n.id })))
  const posta = dati.posta.filter(nell)
  const messaggi = dati.messaggi.filter((m) => area === 'T' || m.area === area)
  const wa = numeroWhatsApp(p.telefono)

  return (
    <div className="schermata scheda-persona">
      <Indietro titolo={nomePersona(p)} />

      {(p.ruolo || ditte.length > 0) && (
        <p className="persona-chi">
          {p.ruolo && <span>{p.ruolo}</span>}
          {ditte.map((d) => (
            <a key={d.aziende.id} href={`#/azienda/${d.aziende.id}`} style={{ '--c': areaDa(d.aziende.area)?.colore }}>
              {d.aziende.nome}{d.ruolo && d.ruolo !== p.ruolo ? ` · ${d.ruolo}` : ''}
            </a>
          ))}
        </p>
      )}
      <p className="nota-piccola"><EtichettePersona p={p} /></p>

      <div className="contatti-persona">
        {/* Dopo la chiamata, tornando nell'app si apre la nota già collegata a questa persona (App.jsx). */}
        {p.telefono && <a className="tasto-piccolo" href={`tel:${p.telefono}`}
          onClick={() => scrivi('chiamata', JSON.stringify({ id, ora: Date.now() }))}>Chiama</a>}
        {dati.chat[0]
          ? <a className="tasto-piccolo" href={`#/whatsapp/${dati.chat[0]}`}>WhatsApp</a>
          : wa && <a className="tasto-piccolo" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a>}
        {p.email && <a className="tasto-piccolo" href={`mailto:${p.email}`}>Scrivi mail</a>}
        <button type="button" className="tasto-piccolo" onClick={() => vai(`/aggiungi?persona=${id}`)}>+ Nota</button>
      </div>
      {(p.telefono || p.email) && (
        <p className="nota-piccola selezionabile">
          {[p.telefono, p.email, ...(p.email_altre || [])].filter(Boolean).join(' · ')}
        </p>
      )}
      {p.compleanno && <p className="nota-piccola">Compleanno: {new Date(p.compleanno).toLocaleDateString('it-CH', { day: 'numeric', month: 'long' })}</p>}

      {dati.eventi.filter(nell).length > 0 && (
        <div className="elenco">
          {dati.eventi.filter(nell).map((e) => (
            <div key={e.id} className="riga">
              <span className="pallino" style={{ background: areaDa(e.area)?.colore || 'var(--grigio)' }} />
              <span className="riga-corpo">
                <span className="riga-testo">{e.titolo}</span>
                <span className="riga-meta">
                  Appuntamento {quando(e.inizio, !e.tutto_il_giorno)}{e.luogo ? ` · ${e.luogo}` : ''}{e.stato === 'proposto' ? ' · proposto' : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {riassunti.length > 0 ? riassunti.map((r) => (
        <section key={r.area} className="blocco riassunto-persona" style={{ '--c': areaDa(r.area).colore }}>
          <h2><span>{areaDa(r.area).nome}</span><span className="nota-piccola">aggiornato {quando(r.aggiornato_il)}</span></h2>
          {VOCI_RIASSUNTO.filter(([k]) => r[k]).map(([k, titolo]) => (
            <div key={k} className={'voce-riassunto' + (k === 'da_chiedere' ? ' in-evidenza' : '')}>
              <h3>{titolo}</h3>
              <p>{r[k]}</p>
            </div>
          ))}
        </section>
      )) : (
        <p className="msg">Il riassunto (chi è, cosa chiedere, come parlarle) lo scrive l'agente entro un'ora, quando ci sono note su questa persona.</p>
      )}

      {promemoria.length > 0 && (
        <>
          <h2>Promemoria</h2>
          <div className="elenco">
            {promemoria.map((x) => (
              <a key={x.id} className="riga" href={`#/nota/${x.nota_id}`}>
                <span className="pallino" style={{ background: areaDa(x.area)?.colore || 'var(--grigio)' }} />
                <span className="riga-corpo">
                  <span className="riga-testo">{x.testo}</span>
                  <span className="riga-meta">{quando(x.scade_il, true) || 'senza data'}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}

      <h2>Note <span className="numero">{note.length}</span></h2>
      {note.length ? (
        <div className="elenco">
          {note.slice(0, 60).map((n) => (
            <a key={n.id} className="riga" href={`#/nota/${n.id}`}>
              <span className="pallino" style={{ background: areaDa(n.area)?.colore || 'var(--grigio)' }} />
              <span className="riga-corpo">
                <span className="riga-testo">{n.testo}</span>
                <span className="riga-meta">
                  {[quando(n.data || n.creata_il), n.aziende?.nome, n.mandante, nomeSezione[n.sezione],
                    n.sezione === 'problemi' ? (n.risolto_il ? 'risolto' : 'aperto') : null].filter(Boolean).join(' · ')}
                </span>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="msg">Nessuna nota{area !== 'T' ? ' in quest\'area' : ''}.</p>
      )}

      {posta.length > 0 && (
        <>
          <h2>Mail <span className="numero">{posta.length}</span></h2>
          <div className="elenco">
            {posta.map((m) => (
              <a key={m.id} className="riga" href={`#/mail/${encodeURIComponent(m.message_id)}`}>
                <span className="pallino" style={{ background: areaDa(m.area)?.colore || 'var(--grigio)' }} />
                <span className="riga-corpo">
                  <span className="riga-testo">{m.oggetto || '(senza oggetto)'}</span>
                  <span className="riga-meta">{m.cartella === 'inviata' ? 'Mandata' : 'Arrivata'} {quando(m.data)}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}

      {messaggi.length > 0 && (
        <>
          <h2>WhatsApp {dati.chat[0] && <a className="tasto-link" href={`#/whatsapp/${dati.chat[0]}`}>Apri la chat</a>}</h2>
          <div className="chat-breve">
            {messaggi.slice(0, 20).reverse().map((m) => (
              <p key={m.id} className={'fumetto ' + (m.direzione === 'out' ? 'mio' : 'suo')}>
                {m.testo || `(${m.tipo})`}
                <span className="riga-meta">{quando(m.data, true)}</span>
              </p>
            ))}
          </div>
        </>
      )}

      <button type="button" className="tasto-link apri-dati" onClick={() => setAperto(!aperto)} aria-expanded={aperto}>
        <Icona nome={aperto ? 'x' : 'freccia'} size={16} /> {aperto ? 'Chiudi' : 'Modifica dati e aree'}
      </button>
      {aperto && (
        <>
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
            <label>Ruolo<input {...campo('ruolo')} placeholder="es. responsabile showroom" /></label>
            <label>Telefono<input type="tel" inputMode="tel" {...campo('telefono')} /></label>
            <label>Email<input type="email" inputMode="email" {...campo('email')} /></label>
            <label>Compleanno<input type="date" {...campo('compleanno')} /></label>
            {modificato && <button type="button" className="tasto-grande" onClick={salva}>Salva</button>}
          </div>
          <button type="button" className="tasto-link pericolo" onClick={elimina}>Metti nel cestino</button>
        </>
      )}
    </div>
  )
}
