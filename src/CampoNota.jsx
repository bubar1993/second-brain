import { useEffect, useRef, useState } from 'react'
import { sb, areaDa, nomePersona } from './supabase'

// Il campo dove si scrive una nota (10.11.2026, passi 2 e 3 delle note, ok di Giovanni): come un blocco note.
// - Elenchi e caselle: i tasti "• Elenco" e "☐ Casella" mettono il segno all'inizio della riga; Invio continua
//   l'elenco, Invio su una riga vuota lo chiude. Nel testo restano i segni •, ☐ e ☑ (testo semplice: gli agenti
//   lo leggono com'è).
// - @: scrivi @ e due lettere, compaiono persone e ditte; scegliendo, il nome entra nel testo e `onCollega`
//   collega la nota (persona nelle Persone, ditta come Cliente: lo decide la schermata).
// - `autoAlto`: il riquadro è alto quanto il testo.

const SEGNO = /^(\s*)(• |☐ |☑ )/
const CASELLA = /^(\s*)(☐|☑) ?(.*)$/
const pulisci = (s) => s.replace(/[,()%*\\.:]/g, '')

export const haCaselle = (testo) => (testo || '').split('\n').some((r) => CASELLA.test(r))
// Spunta o toglie la spunta alla riga numero `i` del testo.
export function spuntaRiga(testo, i) {
  const righe = testo.split('\n')
  righe[i] = righe[i].replace(/☐|☑/, (s) => (s === '☐' ? '☑' : '☐'))
  return righe.join('\n')
}

// Il testo di una nota da leggere: le righe con ☐/☑ sono caselle da toccare. `soloCaselle`: solo quelle righe.
export function TestoConCaselle({ testo, onSpunta, soloCaselle }) {
  return (testo || '').split('\n').map((riga, i) => {
    const m = riga.match(CASELLA)
    if (!m) return soloCaselle ? null : <span key={i} className="riga-testo-nota">{riga || ' '}</span>
    const fatta = m[2] === '☑'
    return (
      <button key={i} type="button" className={'casella-riga' + (fatta ? ' fatta' : '')} aria-pressed={fatta}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSpunta(i) }}>
        <span className="casella-segno" aria-hidden="true">{fatta ? '☑' : '☐'}</span>
        <span>{m[3]}</span>
      </button>
    )
  })
}

export function CampoNota({ value, onChange, onCollega, rif, autoAlto, barra = true, onKeyDown, ...resto }) {
  const mio = useRef(null)
  const ref = rif || mio
  const [cerca, setCerca] = useState(null) // { parola, da, a }: la parola dopo la @
  const [trovati, setTrovati] = useState([])
  const cursore = useRef(null)

  // Dopo un cambio fatto da qui (segno, @) il cursore torna dove serve.
  useEffect(() => {
    if (cursore.current === null || !ref.current) return
    ref.current.setSelectionRange(cursore.current, cursore.current)
    cursore.current = null
  })
  useEffect(() => {
    const el = ref.current
    if (!autoAlto || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value, autoAlto, ref])

  const cambia = (testo, pos) => { cursore.current = pos; onChange(testo) }

  function guarda(testo, pos) {
    if (!onCollega) return
    const m = testo.slice(0, pos).match(/(^|[\s(])@([\p{L}\p{N}'’&.-]{2,})$/u)
    setCerca(m ? { parola: m[2], da: pos - m[2].length - 1, a: pos } : null)
  }

  const parola = cerca?.parola
  useEffect(() => {
    const p = parola && pulisci(parola)
    if (!p) { setTrovati([]); return }
    let annullato = false
    const t = setTimeout(async () => {
      const [persone, ditte] = await Promise.all([
        sb.from('persone').select('id,nome,cognome').is('eliminata_il', null).or(`nome.ilike.%${p}%,cognome.ilike.%${p}%`).order('nome').limit(5),
        sb.from('aziende').select('id,nome,area').is('eliminata_il', null).is('unito_in', null).ilike('nome', `%${p}%`).order('nome').limit(4),
      ])
      if (annullato) return
      setTrovati([...(persone.data || []).map((x) => ({ tipo: 'persona', x })), ...(ditte.data || []).map((x) => ({ tipo: 'ditta', x }))])
    }, 200)
    return () => { annullato = true; clearTimeout(t) }
  }, [parola])

  function scegli(v) {
    const nome = v.tipo === 'persona' ? nomePersona(v.x) : v.x.nome
    cambia(`${value.slice(0, cerca.da)}${nome} ${value.slice(cerca.a)}`, cerca.da + nome.length + 1)
    setCerca(null)
    onCollega(v)
    ref.current?.focus()
  }

  // Invio dentro un elenco: riga nuova con lo stesso segno; su una riga col solo segno, l'elenco finisce.
  function tasto(e) {
    onKeyDown?.(e)
    if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return
    const el = e.target
    const pos = el.selectionStart
    if (pos !== el.selectionEnd) return
    const inizio = value.lastIndexOf('\n', pos - 1) + 1
    const riga = value.slice(inizio, pos)
    const m = riga.match(SEGNO)
    if (!m) return
    e.preventDefault()
    if (!riga.slice(m[0].length).trim()) return cambia(value.slice(0, inizio) + value.slice(pos), inizio)
    const nuovo = `\n${m[1]}${m[2] === '☑ ' ? '☐ ' : m[2]}`
    cambia(value.slice(0, pos) + nuovo + value.slice(pos), pos + nuovo.length)
  }

  // Tasti "Elenco" e "Casella": mettono, cambiano o tolgono il segno della riga dove sta il cursore.
  function metti(segno) {
    const el = ref.current
    const pos = el ? el.selectionStart : value.length
    const inizio = value.lastIndexOf('\n', pos - 1) + 1
    const m = value.slice(inizio).match(SEGNO)
    const vecchio = m ? m[0].length : 0
    const stesso = m && m[2].replace('☑', '☐') === segno
    const messo = stesso ? (m[1] || '') : `${m?.[1] || ''}${segno}`
    cambia(value.slice(0, inizio) + messo + value.slice(inizio + vecchio), Math.max(inizio + messo.length, pos + messo.length - vecchio))
    el?.focus()
  }
  // Il tocco sul tasto non deve chiudere la tastiera del telefono.
  const fermo = (e) => e.preventDefault()

  return (
    <div className="campo-nota">
      <textarea ref={ref} value={value} {...resto} onKeyDown={tasto}
        onChange={(e) => { onChange(e.target.value); guarda(e.target.value, e.target.selectionStart) }}
        onBlur={() => setTimeout(() => setCerca(null), 250)} />
      {cerca && trovati.length > 0 && (
        <div className="tendina">
          {trovati.map((v) => (
            <button key={v.tipo + v.x.id} type="button" onMouseDown={fermo} onClick={() => scegli(v)}>
              {v.tipo === 'persona'
                ? <>{nomePersona(v.x)} <span className="nota-piccola">persona</span></>
                : <><span className="pallino" style={{ background: areaDa(v.x.area)?.colore }} /> {v.x.nome} <span className="nota-piccola">{areaDa(v.x.area)?.nome}</span></>}
            </button>
          ))}
        </div>
      )}
      {barra && (
        <div className="barra-nota">
          <button type="button" className="chip piccolo" onMouseDown={fermo} onClick={() => metti('• ')}>• Elenco</button>
          <button type="button" className="chip piccolo" onMouseDown={fermo} onClick={() => metti('☐ ')}>☐ Casella</button>
          {onCollega && <span className="nota-piccola">@ per collegare una persona o una ditta</span>}
        </div>
      )}
    </div>
  )
}
