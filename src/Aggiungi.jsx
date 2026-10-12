import { useEffect, useRef, useState } from 'react'
import { sb, areaDa } from './supabase'
import {
  useApp, chk, messaggioErrore, SceltaArea, SceltaPersone, Icona,
  useDettatura, caricaFoto, collegaPersone,
} from './componenti'

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']

// "Ricordami oggi alle 19:30", "ricordamelo domani alle 9", "ricordami venerdì alle 10.15":
// se la nota lo dice, il promemoria si crea subito (senza aspettare l'agente).
export function quandoRicordare(testo, adesso = new Date()) {
  const t = testo.toLowerCase()
  if (!/ricord/.test(t)) return null
  const ora = t.match(/\balle?\s+(\d{1,2})(?:[:.](\d{2}))?\b/)
  if (!ora) return null
  const h = Number(ora[1])
  const m = Number(ora[2] || 0)
  if (h > 23 || m > 59) return null
  const d = new Date(adesso)
  d.setSeconds(0, 0)
  let salto = 1 // "alle 9" detto la sera senza giorno: domani
  if (/dopodomani/.test(t)) d.setDate(d.getDate() + 2)
  else if (/domani/.test(t)) d.setDate(d.getDate() + 1)
  else {
    const g = GIORNI.findIndex((x) => t.includes(x) || t.includes(x.replace('ì', 'i')))
    if (g >= 0) { d.setDate(d.getDate() + ((g - d.getDay() + 7) % 7)); salto = 7 }
  }
  d.setHours(h, m)
  if (d < adesso) d.setDate(d.getDate() + salto)
  return d
}

// Aggiungi: scrivi, parla o foto. Senza area la nota va nell'Inbox.
export default function Aggiungi({ usaCondiviso, personaId }) {
  const { area, avvisa, utente } = useApp()
  const [condiviso] = useState(() => usaCondiviso())
  const [testo, setTesto] = useState(condiviso?.testo || '')
  const [areaNota, setAreaNota] = useState(area === 'T' ? null : area)
  const [persone, setPersone] = useState([])
  const [foto, setFoto] = useState([])
  const [ricorda, setRicorda] = useState('')
  const [conPromemoria, setConPromemoria] = useState(false)
  const [fonte, setFonte] = useState(condiviso ? 'condivisa' : 'scritta')
  const [salvo, setSalvo] = useState(false)
  const scattaRif = useRef(null)
  const testoRif = useRef(null)

  const dettatura = useDettatura((t) => {
    setTesto((x) => (x.trim() ? x.trimEnd() + ' ' : '') + t)
    setFonte((f) => (f === 'scritta' ? 'voce' : f))
  })

  // Arrivo dalla scheda di una persona: la collego già.
  useEffect(() => {
    if (!personaId) return
    sb.from('persone').select('id,nome,cognome').eq('id', personaId).single()
      .then(({ data }) => data && setPersone([data]))
  }, [personaId])

  // Libera le anteprime quando si esce dalla schermata.
  const fotoRif = useRef(foto)
  fotoRif.current = foto
  useEffect(() => () => fotoRif.current.forEach((f) => URL.revokeObjectURL(f.url)), [])

  function aggiungiFoto(e) {
    const nuove = [...e.target.files].map((file) => ({ file, url: URL.createObjectURL(file) }))
    setFoto((f) => [...f, ...nuove])
    e.target.value = ''
  }

  function svuota() {
    setTesto('')
    setPersone([])
    setFoto([])
    setRicorda('')
    setConPromemoria(false)
    setFonte('scritta')
    testoRif.current?.focus()
  }

  async function salva() {
    const pulito = testo.trim()
    if (!pulito && !foto.length) return avvisa('Scrivi qualcosa o aggiungi una foto')
    if (conPromemoria && !ricorda) return avvisa('Scegli quando ricordartelo')
    setSalvo(true)
    try {
      const nota = chk(await sb.from('note')
        .insert({ testo: pulito, area: areaNota, fonte: !pulito && foto.length ? 'foto' : fonte })
        .select('id').single())
      await collegaPersone(nota.id, areaNota, persone)
      for (const f of foto) await caricaFoto(utente.id, nota.id, f.file)
      // Promemoria scelto col tasto, oppure detto nella nota ("ricordami alle 19:30").
      const detto = !conPromemoria ? quandoRicordare(pulito) : null
      if (conPromemoria || detto) {
        chk(await sb.from('promemoria').insert({
          testo: pulito || 'Foto', area: areaNota, nota_id: nota.id,
          scade_il: (detto || new Date(ricorda)).toISOString(),
        }))
      }
      const dove = areaNota ? `Salvata in ${areaDa(areaNota).nome}` : 'Salvata nell\'Inbox'
      avvisa(detto ? `${dove}. Te lo ricordo ${detto.toLocaleDateString('it-CH', { weekday: 'long' })} alle ${detto.toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })}` : dove)
      svuota()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setSalvo(false)
    }
  }

  return (
    <div className="schermata aggiungi-schermata">
      <textarea ref={testoRif} value={testo} onChange={(e) => setTesto(e.target.value)}
        placeholder="Cosa vuoi ricordare?" rows={5} autoFocus={!condiviso} />

      <div className="strumenti">
        {dettatura.supportata && (
          <button type="button" className={'tasto-tondo' + (dettatura.attiva ? ' ascolta' : '')}
            onClick={dettatura.attiva ? dettatura.ferma : dettatura.avvia}
            aria-label={dettatura.attiva ? 'Ferma dettatura' : 'Detta'}>
            <Icona nome="mic" />
            <span>{dettatura.attiva ? 'Ascolto…' : 'Parla'}</span>
          </button>
        )}
        <button type="button" className="tasto-tondo" onClick={() => scattaRif.current?.click()} aria-label="Foto">
          <Icona nome="foto" />
          <span>Foto</span>
        </button>
        <button type="button" className={'tasto-tondo' + (conPromemoria ? ' acceso' : '')}
          onClick={() => setConPromemoria((v) => !v)} aria-pressed={conPromemoria}>
          <Icona nome="campana" />
          <span>Ricordamelo</span>
        </button>
        <input ref={scattaRif} type="file" accept="image/*" multiple hidden onChange={aggiungiFoto} />
      </div>

      {foto.length > 0 && (
        <div className="miniature">
          {foto.map((f, i) => (
            <div key={f.url} className="miniatura">
              <img src={f.url} alt="" />
              <button type="button" aria-label="Togli foto" onClick={() => setFoto((x) => x.filter((_, j) => j !== i))}>
                <Icona nome="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {conPromemoria && (
        <label className="campo">
          Quando
          <input type="datetime-local" value={ricorda} onChange={(e) => setRicorda(e.target.value)} />
        </label>
      )}

      <div className="campo">
        <span>Area</span>
        <SceltaArea valore={areaNota} onChange={setAreaNota} />
      </div>

      <div className="campo">
        <span>Persone</span>
        <SceltaPersone valore={persone} onChange={setPersone} />
      </div>

      <button type="button" className="tasto-grande" onClick={salva} disabled={salvo}>
        {salvo ? 'Salvo…' : 'Salva'}
      </button>
    </div>
  )
}
