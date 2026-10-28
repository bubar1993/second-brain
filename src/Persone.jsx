import { useEffect, useState } from 'react'
import { sb, AREE, areaDa, nomePersona, quando, CAMPI_PERSONA, etichettePersona, numeroWhatsApp, scrivi } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Indietro, EtichettePersona, Icona, useModifiche } from './componenti'
import { nomeSezione } from './Aziende'
import { condividi } from './Rubrica'

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

  const [aperti, setAperti] = useState([]) // persone con il menu a tendina aperto (es. i figli di Lady di Blackwood)
  // Ordine (14.10.2026, scelta di Giovanni): prima quelle "in cima" (Lady di Blackwood, Leonardo, Jolie),
  // poi chi ha più note, messaggi WhatsApp e appuntamenti (vista persone_uso), poi per nome.
  const { dati, errore, carica } = useCarica(async () => {
    const [persone, uso] = await Promise.all([
      sb.from('persone').select(CAMPI_PERSONA + ',email,ruolo,in_cima,sotto_id').is('eliminata_il', null).order('nome').order('cognome').then(chk),
      sb.from('persone_uso').select('id,uso').gt('uso', 0).then(chk),
    ])
    const n = Object.fromEntries(uso.map((u) => [u.id, u.uso]))
    return persone.map((p) => ({ ...p, uso: n[p.id] || 0 }))
      .sort((a, b) => (a.in_cima ?? 99) - (b.in_cima ?? 99) || b.uso - a.uso)
  }, [])

  const conteggi = {}
  const tutte = (dati || []).map((p) => {
    const k = chiaveDi(areeDi(p))
    conteggi[k] = (conteggi[k] || 0) + 1
    return { ...p, chiave: k, cercabile: [nomePersona(p), p.email, p.ruolo, ...etichettePersona(p).map((e) => e.testo)].join(' ').toLowerCase() }
  })

  const parole = cerca.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const trovate = tutte.filter((p) =>
    (scelta === null || p.chiave === scelta) &&
    (area === 'T' || p.chiave.includes(area)) &&
    parole.every((w) => p.cercabile.includes(w)))
  // Senza ricerca chi sta "sotto" un'altra persona si vede solo aprendo il suo menu a tendina.
  const sottoDi = (p) => trovate.filter((x) => x.sotto_id === p.id)
  const visibili = parole.length ? trovate : trovate.filter((p) => !p.sotto_id || !trovate.some((x) => x.id === p.sotto_id))
  const riga = (p, figlia = false) => (
    <a key={p.id} className={'riga' + (figlia ? ' riga-figlia' : '')} href={`#/persona/${p.id}`}>
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
  )

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
            {visibili.slice(0, 200).map((p) => {
              const figli = parole.length ? [] : sottoDi(p)
              if (!figli.length) return riga(p)
              const aperto = aperti.includes(p.id)
              // Una sola "cella": la persona, il menu a tendina e (aperto) le persone sotto di lei.
              return (
                <div key={p.id} className="gruppo-persona">
                  {riga(p)}
                  <button type="button" className="riga-tendina" aria-expanded={aperto}
                    onClick={() => setAperti(aperto ? aperti.filter((x) => x !== p.id) : [...aperti, p.id])}>
                    {aperto ? '▴' : '▾'} {figli.map((f) => f.nome).join(', ')}
                  </button>
                  {aperto && figli.map((f) => riga(f, true))}
                </div>
              )
            })}
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

// Ditte della persona scelte a mano (13.10.2026): cerca e aggiungi, oppure togli.
// Le ditte tolte si ricordano (persone_aziende_tolte), così la copia dai contatti delle schede non le rimette.
function DittePersona({ id, collegate, ricarica }) {
  const { area, avvisa } = useApp()
  const [testo, setTesto] = useState('')
  const [trovate, setTrovate] = useState([])
  const giaCollegate = collegate.map((c) => c.aziende.id).join(',')

  useEffect(() => {
    const parole = testo.trim().split(/\s+/).map((s) => s.replace(/[,()%*\\.:]/g, '')).filter(Boolean)
    if (!parole.length || testo.trim().length < 2) { setTrovate([]); return }
    let annullato = false
    const t = setTimeout(async () => {
      let q = sb.from('aziende').select('id,nome,area').is('eliminata_il', null).is('unito_in', null).order('nome').limit(8)
      if (area !== 'T') q = q.eq('area', area)
      for (const p of parole) q = q.or(`nome.ilike.%${p}%,ragione_sociale.ilike.%${p}%`)
      const { data } = await q
      if (!annullato) setTrovate((data || []).filter((a) => !giaCollegate.split(',').includes(a.id)))
    }, 200)
    return () => { annullato = true; clearTimeout(t) }
  }, [testo, area, giaCollegate])

  async function aggiungi(a, ruolo = null) {
    chk(await sb.from('persone_aziende_tolte').delete().eq('persona_id', id).eq('azienda_id', a.id))
    chk(await sb.from('persone_aziende').upsert({ persona_id: id, azienda_id: a.id, ruolo }, { onConflict: 'persona_id,azienda_id' }))
  }
  async function togli(a) {
    chk(await sb.from('persone_aziende').delete().eq('persona_id', id).eq('azienda_id', a.id))
    chk(await sb.from('persone_aziende_tolte').upsert({ persona_id: id, azienda_id: a.id }, { onConflict: 'persona_id,azienda_id' }))
  }

  async function scegli(a) {
    try {
      await aggiungi(a)
      setTesto('')
      ricarica()
      avvisa(`Aggiunta ${a.nome}`, { etichetta: 'Annulla', fai: async () => { await togli(a); ricarica() } })
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }
  async function toglila(d) {
    try {
      await togli(d.aziende)
      ricarica()
      avvisa(`Tolta ${d.aziende.nome}`, { etichetta: 'Annulla', fai: async () => { await aggiungi(d.aziende, d.ruolo); ricarica() } })
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  return (
    <div className="scelta-persone">
      <p className="nota-piccola">Ditte</p>
      {collegate.length > 0 && (
        <div className="chips">
          {collegate.map((d) => (
            <span key={d.aziende.id} className="chip attivo" style={{ '--c': areaDa(d.aziende.area)?.colore }}>
              <a href={`#/azienda/${d.aziende.id}`}>{d.aziende.nome}</a>
              <button type="button" aria-label={`Togli ${d.aziende.nome}`} onClick={() => toglila(d)}>
                <Icona nome="x" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input type="text" value={testo} onChange={(e) => setTesto(e.target.value)}
        placeholder="Aggiungi una ditta…" autoComplete="off" enterKeyHint="search" />
      {testo.trim().length >= 2 && (
        <div className="tendina">
          {trovate.map((a) => (
            <button key={a.id} type="button" onClick={() => scegli(a)}>
              <span className="pallino" style={{ background: areaDa(a.area)?.colore }} /> {a.nome} <span className="nota-piccola">{areaDa(a.area)?.nome}</span>
            </button>
          ))}
          {!trovate.length && <p className="msg">Nessuna ditta con questo nome{area !== 'T' ? ' in quest\'area' : ''}.</p>}
        </div>
      )}
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
  const [tutteAree, setTutteAree] = useState(false)
  useModifiche(modificato)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const p = chk(await sb.from('persone').select('*,' + CAMPI_PERSONA.replace('id,nome,cognome,', '')).eq('id', id).single())
    const indirizzi = [p.email, ...(p.email_altre || [])].filter(Boolean).map((e) => e.toLowerCase())
    const ditte = p.persone_aziende.map((x) => x.aziende?.id).filter(Boolean)
    const ieri = new Date(Date.now() - 86400000).toISOString()
    const [np, riassunti, wa, posta, ev, rub] = await Promise.all([
      sb.from('note_persone').select('note(id,area,testo,fonte,data,creata_il,eliminata_il,scartata_il,sezione,mandante,risolto_il,azienda_id,aziende(id,nome),promemoria(id,testo,scade_il,fatto_il,eliminata_il))').eq('persona_id', id),
      sb.from('persone_riassunti').select('*').eq('persona_id', id),
      sb.from('wa_contatti').select('wa_id,area,wa_messaggi(id,direzione,testo,tipo,data)').eq('persona_id', id)
        .order('data', { referencedTable: 'wa_messaggi', ascending: false }).limit(20, { referencedTable: 'wa_messaggi' }),
      indirizzi.length
        ? sb.from('posta').select('id,area,message_id,da,da_nome,oggetto,data,cartella')
          .or(indirizzi.flatMap((e) => [`da.ilike.${e}`, `a.cs.{${e}}`]).join(','))
          .order('data', { ascending: false }).limit(15)
        : Promise.resolve({ data: [] }),
      sb.from('eventi').select('id,titolo,inizio,tutto_il_giorno,luogo,area,stato,cambio')
        .or([`persona_id.eq.${id}`, ...(ditte.length ? [`azienda_id.in.(${ditte.join(',')})`] : [])].join(','))
        .in('stato', ['confermato', 'da_creare', 'proposto']).gte('inizio', ieri).order('inizio').limit(5),
      // Il contatto del telefono collegato (Rubrica, 13.10.2026): le modifiche qui vanno anche lì.
      sb.from('rubrica').select('id,nome,cognome,ditta,ruolo,telefoni,email,compleanno').eq('persona_id', id).is('eliminata_il', null).limit(1),
    ])
    const note = chk(np).map((x) => x.note).filter((n) => n && !n.eliminata_il && !n.scartata_il)
      .sort((a, b) => (b.data || b.creata_il).localeCompare(a.data || a.creata_il))
    const messaggi = chk(wa).flatMap((c) => c.wa_messaggi.map((m) => ({ ...m, area: c.area })))
      .sort((a, b) => b.data.localeCompare(a.data))
    // Appuntamenti spostati dall'app: con la data nuova (in Google arriva entro 10 minuti).
    const eventi = chk(ev).map((e) => ({ ...e, ...(e.cambio || {}) })).sort((a, b) => a.inizio.localeCompare(b.inizio))
    return { p, note, riassunti: chk(riassunti), messaggi, posta: chk(posta), chat: chk(wa).map((c) => c.wa_id), eventi, contatto: chk(rub)[0] || null }
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
      let msg = 'Salvato'
      if (dati.contatto) {
        try {
          await chiama('rubrica', { azione: 'salva', persona_id: id })
          msg = 'Salvato, anche sul telefono'
        } catch (e) {
          msg = `Salvato qui, ma non sul telefono: ${messaggioErrore(e)}`
        }
      }
      avvisa(msg)
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
  // Con un'area scelta in alto si vede solo quella; "mostrale" fa vedere anche le altre, solo qui (14.10.2026).
  const nell = (x) => area === 'T' || tutteAree || x.area === area
  const fuori = area === 'T' || tutteAree ? 0
    : dati.note.filter((x) => x.area !== area).length + dati.posta.filter((x) => x.area !== area).length
      + dati.messaggi.filter((x) => x.area !== area).length
  const aree = p.persone_aree.map((x) => x.area)
  const ditte = p.persone_aziende.filter((x) => x.aziende && nell(x.aziende))
  const riassunti = dati.riassunti.filter(nell).sort((a, b) => 'CGP'.indexOf(a.area) - 'CGP'.indexOf(b.area))
  const note = dati.note.filter(nell)
  const promemoria = note.flatMap((n) => (n.promemoria || []).filter((x) => !x.fatto_il && !x.eliminata_il)
    .map((x) => ({ ...x, area: n.area, nota_id: n.id })))
  const posta = dati.posta.filter(nell)
  const messaggi = dati.messaggi.filter(nell)
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
      {fuori > 0 && (
        <button type="button" className="scheda altre-aree" onClick={() => setTutteAree(true)}>
          <span>Vedi solo {areaDa(area).nome}: {fuori === 1 ? 'c\'è un\'altra cosa' : `ci sono altre ${fuori} cose`} (note, mail, WhatsApp) in altre aree.</span>
          <span className="tasto-piccolo">Mostrale</span>
        </button>
      )}
      {tutteAree && area !== 'T' && (
        <p className="nota-piccola">Vedi tutte le aree. <button type="button" className="tasto-link" onClick={() => setTutteAree(false)}>Solo {areaDa(area).nome}</button></p>
      )}

      <div className="contatti-persona">
        {/* Dopo la chiamata, tornando nell'app si apre la nota già collegata a questa persona (App.jsx). */}
        {p.telefono && <a className="tasto-piccolo" href={`tel:${p.telefono}`}
          onClick={() => scrivi('chiamata', JSON.stringify({ id, ora: Date.now() }))}>Chiama</a>}
        {dati.chat[0]
          ? <a className="tasto-piccolo" href={`#/whatsapp/${dati.chat[0]}`}>WhatsApp</a>
          : wa && <a className="tasto-piccolo" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a>}
        {p.email && <a className="tasto-piccolo" href={`mailto:${p.email}`}>Scrivi mail</a>}
        <button type="button" className="tasto-piccolo" onClick={() => vai(`/aggiungi?persona=${id}`)}>+ Nota</button>
        <button type="button" className="tasto-piccolo" onClick={() => condividi(dati.contatto || {
          nome: p.nome, cognome: p.cognome, ditta: ditte[0]?.aziende.nome, ruolo: p.ruolo, compleanno: p.compleanno,
          telefoni: p.telefono ? [{ valore: p.telefono }] : [], email: p.email ? [{ valore: p.email }] : [],
        }, avvisa)}>Condividi</button>
        {dati.contatto && <a className="tasto-piccolo" href={`#/rubrica/${dati.contatto.id}`}>Nella rubrica</a>}
      </div>
      {(p.telefono || p.email) && (
        <p className="nota-piccola selezionabile">
          {[p.telefono, p.email, ...(p.email_altre || [])].filter(Boolean).join(' · ')}
        </p>
      )}
      {p.compleanno && <p className="nota-piccola">Compleanno: {new Date(p.compleanno).toLocaleDateString('it-CH', { day: 'numeric', month: 'long' })}</p>}

      {dati.eventi.filter(nell).length > 0 && (
        <div className="elenco">
          {/* Tocco: la pagina dell'appuntamento, dove prendi gli appunti della visita. */}
          {dati.eventi.filter(nell).map((e) => (
            <a key={e.id} className="riga" href={`#/visita/${e.id}`}>
              <span className="pallino" style={{ background: areaDa(e.area)?.colore || 'var(--grigio)' }} />
              <span className="riga-corpo">
                <span className="riga-testo">{e.titolo}</span>
                <span className="riga-meta">
                  Appuntamento {quando(e.inizio, !e.tutto_il_giorno)}{e.luogo ? ` · ${e.luogo}` : ''}{e.stato === 'proposto' ? ' · proposto' : e.cambio ? ' · spostato' : ' · appunti o sposta'}
                </span>
              </span>
              <Icona nome="freccia" size={18} />
            </a>
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
        <p className="msg">Nessuna nota{area !== 'T' && !tutteAree ? ' in quest\'area' : ''}.</p>
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
          <DittePersona id={id} collegate={p.persone_aziende.filter((x) => x.aziende)} ricarica={ricarica} />
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
