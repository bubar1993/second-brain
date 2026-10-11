import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { sb, AREE, areaDa, nomePersona, quando } from './supabase'

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

const PERCORSI = {
  oggi: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  piu: 'M12 5v14M5 12h14',
  cerca: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  dentro: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  indietro: 'M15 5l-7 7 7 7',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  foto: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  campana: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  x: 'M6 6l12 12M18 6 6 18',
  freccia: 'M9 5l7 7-7 7',
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
      let q = sb.from('persone').select('id,nome,cognome').is('eliminata_il', null).order('nome').limit(6)
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
              {nomePersona(p)}
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
              {nomePersona(p)}
            </button>
          ))}
          <button type="button" className="crea" onClick={crea}>+ Nuova persona «{testo.trim()}»</button>
        </div>
      )}
    </div>
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
