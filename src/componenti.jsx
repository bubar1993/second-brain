import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { sb, AREE, areaDa, nomePersona, quando, CAMPI_PERSONA, etichettePersona } from './supabase'

// Stato condiviso: area scelta, utente, avvisi.
export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

export function chk({ data, error }) {
  if (error) throw error
  return data
}

export function messaggioErrore(e) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'Senza rete. Riprova quando sei connesso.'
  return e?.message || 'Qualcosa non ha funzionato.'
}

// Chiama una funzione del second brain e restituisce il suo messaggio d'errore leggibile.
export async function chiama(nome, body) {
  const { data, error } = await sb.functions.invoke(nome, { body })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).errore || msg } catch { /* resta il messaggio */ }
    throw new Error(msg)
  }
  if (data?.errore) throw new Error(data.errore)
  return data
}

// Schermate con modifiche non ancora salvate: tornando nell'app non si ricaricano (App.jsx).
const modifiche = new Set()
export const haModifiche = () => modifiche.size > 0
export function useModifiche(attive) {
  useEffect(() => {
    if (!attive) return
    const k = {}
    modifiche.add(k)
    return () => { modifiche.delete(k) }
  }, [attive])
}

// Cose da ritrovare tornando indietro su questa pagina (ricerca, risultati). Una pagina nuova parte vuota:
// ogni pagina della cronologia ha il suo segno (App.jsx).
export function tenutoQui(nome) {
  try {
    const t = JSON.parse(sessionStorage.getItem(`qui:${nome}`) || 'null')
    return t?.k && t.k === history.state?.k ? t.valore : null
  } catch { return null }
}
export function tieniQui(nome, valore) {
  try { sessionStorage.setItem(`qui:${nome}`, JSON.stringify({ k: history.state?.k, valore })) } catch { /* niente */ }
}

// Data e ora per un campo datetime-local ("2026-10-12T08:00"), nell'ora del telefono.
export function perCampo(d) {
  if (!d) return ''
  const x = new Date(d)
  const due = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${due(x.getMonth() + 1)}-${due(x.getDate())}T${due(x.getHours())}:${due(x.getMinutes())}`
}

// Carica dati per una schermata; ricarica() li rilegge.
export function useCarica(fn, deps) {
  const [stato, setStato] = useState({ dati: null, errore: null, carica: true })
  const giro = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ricarica = useCallback(async () => {
    const mio = ++giro.current
    setStato((s) => ({ ...s, carica: true }))
    try {
      const dati = await fn()
      if (mio === giro.current) setStato({ dati, errore: null, carica: false })
    } catch (e) {
      if (mio === giro.current) setStato((s) => ({ dati: s.dati, errore: messaggioErrore(e), carica: false }))
    }
  }, deps)
  useEffect(() => { ricarica() }, [ricarica])
  return { ...stato, ricarica }
}

// Schermo largo (PC): menu a sinistra e schermate divise. Stesso valore di stile.css.
const LARGO = '(min-width: 1024px)'
export function useLargo() {
  const [largo, setLargo] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(LARGO).matches)
  useEffect(() => {
    const m = matchMedia(LARGO)
    const cambia = () => setLargo(m.matches)
    m.addEventListener('change', cambia)
    return () => m.removeEventListener('change', cambia)
  }, [])
  return largo
}

const PERCORSI = {
  aziende: 'M4 20V8l5-3v15M9 20V4h11v16M3 20h18M12 8h2M16 8h2M12 12h2M16 12h2M12 16h2M16 16h2',
  persone: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2 .7 3 2.8 3 6',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z',
  bozze: 'M3 6h18v12H3zM3 7l9 6 9-6',
  note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5',
  cestino: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  esci: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  oggi: 'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zM2.5 12c0-2 4.3-3.7 9.5-3.7s9.5 1.7 9.5 3.7-4.3 3.7-9.5 3.7S2.5 14 2.5 12z',
  piu: 'M12 5v14M5 12h14',
  cerca: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  dentro: 'M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7.5 7.5l9 9M16.5 7.5l-9 9',
  indietro: 'M15 5l-7 7 7 7',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  foto: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  campana: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  x: 'M6 6l12 12M18 6 6 18',
  freccia: 'M9 5l7 7-7 7',
  whatsapp: 'M4 20l1.3-4A8.5 8.5 0 1 1 8 18.7zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 1c-1.2-.5-2.3-1.6-2.8-2.8l1-1-1-2z',
  domande: 'M12 21a9 9 0 1 0-8-4.9L3 21l4.9-1A9 9 0 0 0 12 21zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2M12 16.5v.01',
  telefono: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  gemelli: 'M8 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM4 20v-3a4 4 0 0 1 8 0v3M12 20v-3a4 4 0 0 1 8 0v3',
  agenti: 'M12 3v3M8 3h8M5 7h14v12H5zM9.5 12v.01M14.5 12v.01M9 16h6M2 12v3M22 12v3',
  ordini: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
}

export function Icona({ nome, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PERCORSI[nome]} />
    </svg>
  )
}

export function Indietro({ titolo }) {
  return (
    <div className="testata">
      <button type="button" className="tasto-indietro" onClick={() => history.back()} aria-label="Indietro">
        <Icona nome="indietro" />
      </button>
      <h1>{titolo}</h1>
    </div>
  )
}

export function Stato({ carica, errore, vuoto, children }) {
  if (errore) return <p className="msg errore">{errore}</p>
  if (carica && !children) return <p className="msg">Carico…</p>
  if (vuoto) return <p className="msg">{vuoto}</p>
  return children
}

// Scelta dell'area di una nota: Inbox (nessuna area) oppure C, G, P.
export function SceltaArea({ valore, onChange, conInbox = true }) {
  return (
    <div className="scelta-area" role="group" aria-label="Area">
      {conInbox && (
        <button type="button" className={'chip' + (!valore ? ' attivo' : '')} onClick={() => onChange(null)}>
          Inbox
        </button>
      )}
      {AREE.map((a) => (
        <button key={a.codice} type="button" style={{ '--c': a.colore }}
          className={'chip chip-area' + (valore === a.codice ? ' attivo' : '')}
          onClick={() => onChange(a.codice)}>
          {a.nome}
        </button>
      ))}
    </div>
  )
}

const pulisci = (s) => s.replace(/[,()%*\\.:]/g, '')

// Collega persone: cerca per nome, oppure crea una persona nuova.
export function SceltaPersone({ valore, onChange }) {
  const { avvisa } = useApp()
  const [testo, setTesto] = useState('')
  const [trovate, setTrovate] = useState([])

  useEffect(() => {
    const parole = testo.trim().split(/\s+/).map(pulisci).filter(Boolean)
    if (!parole.length || testo.trim().length < 2) { setTrovate([]); return }
    let annullato = false
    const t = setTimeout(async () => {
      let q = sb.from('persone').select(CAMPI_PERSONA).is('eliminata_il', null).order('nome').limit(8)
      for (const p of parole) q = q.or(`nome.ilike.%${p}%,cognome.ilike.%${p}%`)
      const { data } = await q
      if (!annullato) setTrovate((data || []).filter((p) => !valore.some((v) => v.id === p.id)))
    }, 200)
    return () => { annullato = true; clearTimeout(t) }
  }, [testo, valore])

  async function crea() {
    const parti = testo.trim().split(/\s+/)
    const nome = parti.shift()
    const cognome = parti.join(' ') || null
    try {
      const p = chk(await sb.from('persone').insert({ nome, cognome }).select('id,nome,cognome').single())
      onChange([...valore, p])
      setTesto('')
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  return (
    <div className="scelta-persone">
      {valore.length > 0 && (
        <div className="chips">
          {valore.map((p) => (
            <span key={p.id} className="chip attivo">
              <a href={`#/persona/${p.id}`}>{nomePersona(p)}</a>
              <button type="button" aria-label={`Togli ${nomePersona(p)}`}
                onClick={() => onChange(valore.filter((v) => v.id !== p.id))}>
                <Icona nome="x" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input type="text" value={testo} onChange={(e) => setTesto(e.target.value)}
        placeholder="Collega una persona…" autoComplete="off" enterKeyHint="search" />
      {testo.trim().length >= 2 && (
        <div className="tendina">
          {trovate.map((p) => (
            <button key={p.id} type="button" onClick={() => { onChange([...valore, p]); setTesto('') }}>
              {nomePersona(p)} <EtichettePersona p={p} tra />
            </button>
          ))}
          <button type="button" className="crea" onClick={crea}>+ Nuova persona «{testo.trim()}»</button>
        </div>
      )}
    </div>
  )
}

// "(Ceramex, Gaffuri · Privato)": dove sta una persona, ogni area nel suo colore.
export function EtichettePersona({ p, tra = false }) {
  const voci = etichettePersona(p)
  if (!voci.length) return null
  return (
    <span className="etichette-persona">
      {tra && '('}
      {voci.map((v, i) => (
        <span key={v.area.codice} style={{ color: v.area.colore }}>{i > 0 && ' · '}{v.testo}</span>
      ))}
      {tra && ')'}
    </span>
  )
}

export function NotaRiga({ nota }) {
  const a = areaDa(nota.area)
  const persone = (nota.note_persone || []).map((np) => np.persone).filter(Boolean)
  const foto = nota.allegati?.length || 0
  return (
    <a className="riga" href={`#/nota/${nota.id}`}>
      <span className="pallino" style={{ background: a ? a.colore : 'var(--grigio)' }} />
      <span className="riga-corpo">
        <span className="riga-testo">{nota.testo || (foto ? 'Foto' : '(vuota)')}</span>
        <span className="riga-meta">
          {quando(nota.creata_il)}
          {persone.length > 0 && ` · ${persone.map(nomePersona).join(', ')}`}
          {foto > 0 && ` · ${foto} foto`}
        </span>
      </span>
    </a>
  )
}

// Dettatura con il riconoscimento vocale del telefono.
export function useDettatura(onTesto) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  const [attiva, setAttiva] = useState(false)
  const rif = useRef(null)
  const cb = useRef(onTesto)
  cb.current = onTesto

  function avvia() {
    if (!SR) return
    const r = new SR()
    r.lang = 'it-IT'
    r.interimResults = false
    r.continuous = false
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) cb.current(e.results[i][0].transcript.trim())
      }
    }
    r.onend = () => setAttiva(false)
    r.onerror = () => setAttiva(false)
    r.start()
    rif.current = r
    setAttiva(true)
  }
  const ferma = () => rif.current?.stop()

  useEffect(() => () => rif.current?.abort(), [])
  return { supportata: !!SR, attiva, avvia, ferma }
}

// Rimpicciolisce le foto del telefono prima di caricarle (max 1600 px).
async function ridimensiona(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * s)
    c.height = Math.round(bmp.height * s)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82))
    return blob || file
  } catch {
    return file
  }
}

export async function caricaFoto(utenteId, notaId, file) {
  const blob = await ridimensiona(file)
  const percorso = `${utenteId}/${notaId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
  chk(await sb.storage.from('allegati').upload(percorso, blob, { contentType: 'image/jpeg' }))
  chk(await sb.from('allegati').insert({ nota_id: notaId, percorso, tipo: 'image/jpeg' }))
}

// Collega le persone a una nota e, se la nota ha un'area, mette la persona in quell'area.
export async function collegaPersone(notaId, area, persone) {
  if (!persone.length) return
  chk(await sb.from('note_persone').insert(persone.map((p) => ({ nota_id: notaId, persona_id: p.id }))))
  await aggiungiAreaPersone(area, persone.map((p) => p.id))
}

export async function aggiungiAreaPersone(area, idPersone) {
  if (!area || !idPersone.length) return
  chk(await sb.from('persone_aree').upsert(
    idPersone.map((id) => ({ persona_id: id, area })),
    { onConflict: 'persona_id,area', ignoreDuplicates: true },
  ))
}
