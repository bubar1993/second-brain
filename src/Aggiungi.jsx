import { useEffect, useRef, useState } from 'react'
import { sb, areaDa, leggi, scrivi } from './supabase'
import {
  useApp, chk, messaggioErrore, SceltaArea, SceltaPersone, Icona,
  useDettatura, caricaFoto, collegaPersone,
} from './componenti'
import { capisciLista, capisciGaranzia, durata } from './capisci'

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']

// "Ricordami oggi alle 19:30", "ricordamelo domani alle 9", "ricordami venerdì alle 10.15":
// se la nota lo dice, il promemoria si crea subito (senza aspettare l'agente).
// Solo "alle": "al 15 ottobre" o "fino al 12" sono date, non ore (quelle le capisce l'agente).
// Giorno detto senza ora ("ricordami domani"): alle 8.
export function quandoRicordare(testo, adesso = new Date()) {
  const t = testo.toLowerCase()
  if (!/ricord/.test(t)) return null
  const ora = t.match(/\balle\s+(\d{1,2})(?:[:.](\d{2}))?\b/)
  const g = GIORNI.findIndex((x) => new RegExp(`\\b${x}|\\b${x.replace('ì', 'i')}\\b`).test(t))
  const giorno = /dopodomani/.test(t) ? 2 : /domani/.test(t) ? 1 : null
  if (!ora && (giorno === null && g < 0)) return null
  // Senza ora serve proprio "ricordami/ricordamelo" ("mi ricordo che lunedì…" non è un promemoria).
  if (!ora && !/ricorda(mi|melo|rmi|rmelo)\b/.test(t)) return null
  const h = ora ? Number(ora[1]) : 8
  const m = ora ? Number(ora[2] || 0) : 0
  if (h > 23 || m > 59) return null
  const d = new Date(adesso)
  d.setSeconds(0, 0)
  let salto = 1 // "alle 9" detto la sera senza giorno: domani
  if (giorno !== null) d.setDate(d.getDate() + giorno)
  else if (g >= 0) { d.setDate(d.getDate() + ((g - d.getDay() + 7) % 7)); salto = 7 }
  d.setHours(h, m)
  if (d < adesso) d.setDate(d.getDate() + salto)
  return d
}

// Il testo che stai scrivendo resta sul telefono finché non salvi (anche se Android chiude l'app).
const chiaveBozza = (personaId, aziendaId) => `aggiungi:${personaId || ''}:${aziendaId || ''}`
function bozzaSalvata(k) {
  try { return JSON.parse(leggi(k) || 'null') } catch { return null }
}

// Aggiungi: scrivi, parla o foto. Senza area la nota va nell'Inbox.
export default function Aggiungi({ usaCondiviso, personaId, aziendaId, chiamata, detta }) {
  const { area, avvisa, utente, vai } = useApp()
  const [condiviso] = useState(() => usaCondiviso())
  const chiave = chiaveBozza(personaId, aziendaId)
  const [ripresa] = useState(() => (condiviso ? null : bozzaSalvata(chiave)))
  const [testo, setTesto] = useState(condiviso?.testo || ripresa?.testo || '')
  const [areaNota, setAreaNota] = useState(ripresa ? ripresa.area : area === 'T' ? null : area)
  const [persone, setPersone] = useState(ripresa?.persone || [])
  const [ditta, setDitta] = useState(null)
  const [foto, setFoto] = useState([])
  const [ricorda, setRicorda] = useState(ripresa?.ricorda || '')
  const [conPromemoria, setConPromemoria] = useState(!!ripresa?.conPromemoria)
  const [fonte, setFonte] = useState(condiviso ? 'condivisa' : ripresa?.fonte || 'scritta')
  const [salvo, setSalvo] = useState(false)
  // "No, è una nota": il testo non va nella lista / non diventa una garanzia.
  const [soloNota, setSoloNota] = useState(false)
  const scattaRif = useRef(null)
  const testoRif = useRef(null)
  // Nota già creata ma foto non tutte caricate: "Salva" riprova solo le foto (niente note doppie).
  const notaFatta = useRef(null)

  const dettatura = useDettatura((t) => {
    setTesto((x) => (x.trim() ? x.trimEnd() + ' ' : '') + t)
    setFonte((f) => (f === 'scritta' ? 'voce' : f))
  })

  // Scorciatoia "Detta una nota" (tieni premuta l'icona dell'app): microfono subito acceso.
  const dettaPartita = useRef(false)
  useEffect(() => {
    if (!detta || dettaPartita.current || !dettatura.supportata) return
    dettaPartita.current = true
    dettatura.avvia()
  }, [detta, dettatura])

  // Arrivo dalla scheda di una persona: la collego già. Dopo una telefonata il testo comincia da solo.
  useEffect(() => {
    if (!personaId) return
    sb.from('persone').select('id,nome,cognome').eq('id', personaId).single()
      .then(({ data }) => {
        if (!data) return
        setPersone((p) => (p.some((x) => x.id === data.id) ? p : [data, ...p]))
        if (chiamata) setTesto((t) => t || `Telefonata con ${[data.nome, data.cognome].filter(Boolean).join(' ')}: `)
      })
  }, [personaId, chiamata])

  // Arrivo dalla scheda di un'azienda: la nota va in quella scheda (e nella sua area).
  useEffect(() => {
    if (!aziendaId) return
    sb.from('aziende').select('id,nome,area').eq('id', aziendaId).single()
      .then(({ data }) => {
        if (!data) return
        setDitta(data)
        if (!ripresa) setAreaNota(data.area)
      })
  }, [aziendaId, ripresa])

  // Salvo sul telefono mentre scrivi (le foto no: si scelgono di nuovo).
  useEffect(() => {
    const t = setTimeout(() => {
      if (testo.trim()) scrivi(chiave, JSON.stringify({ testo, area: areaNota, persone, ricorda, conPromemoria, fonte }))
      else scrivi(chiave, '')
    }, 600)
    return () => clearTimeout(t)
  }, [chiave, testo, areaNota, persone, ricorda, conPromemoria, fonte])

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
    setSoloNota(false)
    notaFatta.current = null
    scrivi(chiave, '')
    testoRif.current?.focus()
  }

  // Detto "metti il latte nella spesa" o "garanzia lavatrice Fust 2 anni" (con la foto dello scontrino):
  // si vede subito sotto il testo, e con "No, è una nota" resta una nota normale.
  const lista = !soloNota && !ditta ? capisciLista(testo) : null
  const garanzia = !soloNota && !ditta && !lista && (foto.length || /^\s*garanzi/i.test(testo)) ? capisciGaranzia(testo) : null

  async function salva() {
    const pulito = testo.trim()
    if (!pulito && !foto.length) return avvisa('Scrivi qualcosa o aggiungi una foto')
    if (conPromemoria && !ricorda) return avvisa('Scegli quando ricordartelo')
    setSalvo(true)
    try {
      // Solo una lista (senza foto né promemoria): niente nota, va dritto nella lista.
      if (lista && !foto.length && !conPromemoria && !notaFatta.current) {
        chk(await sb.from('liste_voci').insert(lista.voci.map((v) => ({ lista: lista.lista, ...v }))))
        avvisa(lista.lista === 'spesa' ? `Nella spesa: ${lista.voci.map((v) => v.testo).join(', ')}` : `Nei ristoranti: ${lista.voci[0].testo}`,
          { etichetta: 'Apri', fai: () => vai('/liste') })
        svuota()
        return
      }
      let nota = notaFatta.current
      const detto = !conPromemoria ? quandoRicordare(pulito) : null
      // Nella scheda della ditta solo se la nota resta nella sua area (mai cose private nelle schede clienti).
      const inScheda = ditta && ditta.area === areaNota ? ditta : null
      // Una garanzia è privata (se non hai scelto un'altra area) e la mette a posto l'app: gli agenti non la rileggono.
      const areaVera = garanzia && !areaNota ? 'P' : areaNota
      if (!nota) {
        nota = chk(await sb.from('note')
          .insert({
            testo: pulito, area: areaVera, azienda_id: inScheda?.id || null, fonte: !pulito && foto.length ? 'foto' : fonte,
            ...(garanzia || lista ? { lavorata_il: new Date().toISOString() } : {}),
          })
          .select('id').single())
        notaFatta.current = nota
        await collegaPersone(nota.id, areaVera, persone)
        if (garanzia) {
          chk(await sb.from('garanzie').insert({ cosa: garanzia.cosa, negozio: garanzia.negozio, mesi: garanzia.mesi, comprata_il: garanzia.comprata_il, nota_id: nota.id }))
        }
        if (lista) chk(await sb.from('liste_voci').insert(lista.voci.map((v) => ({ lista: lista.lista, ...v, nota_id: nota.id }))))
        // Promemoria scelto col tasto, oppure detto nella nota ("ricordami alle 19:30").
        if (conPromemoria || detto) {
          chk(await sb.from('promemoria').insert({
            testo: pulito || 'Foto', area: areaNota, nota_id: nota.id,
            scade_il: (detto || new Date(ricorda)).toISOString(),
          }))
        }
      }
      // Ogni foto caricata esce dall'elenco: se una non va, "Salva" riprova solo quelle rimaste.
      for (const f of foto) {
        await caricaFoto(utente.id, nota.id, f.file)
        setFoto((x) => x.filter((y) => y !== f))
      }
      if (garanzia) {
        avvisa(`Garanzia salvata: ${garanzia.cosa}, fino al ${garanzia.fine.toLocaleDateString('it-CH')}`, { etichetta: 'Apri', fai: () => vai('/garanzie') })
        svuota()
        return
      }
      const dove = inScheda ? `Salvata nella scheda ${inScheda.nome}` : areaVera ? `Salvata in ${areaDa(areaVera).nome}` : 'Salvata nell\'Inbox'
      avvisa(detto ? `${dove}. Te lo ricordo ${detto.toLocaleDateString('it-CH', { weekday: 'long' })} alle ${detto.toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })}` : dove)
      svuota()
    } catch (e) {
      avvisa(notaFatta.current ? `Nota salvata, ma una foto non è partita: tocca Salva per riprovare. (${messaggioErrore(e)})` : messaggioErrore(e))
    } finally {
      setSalvo(false)
    }
  }

  return (
    <div className="schermata aggiungi-schermata">
      <textarea ref={testoRif} value={testo} onChange={(e) => setTesto(e.target.value)}
        placeholder="Cosa vuoi ricordare?" rows={5} autoFocus={!condiviso} />
      {ripresa?.testo && testo === ripresa.testo && (
        <p className="nota-piccola">
          Ho ripreso il testo che stavi scrivendo.{' '}
          <button type="button" className="tasto-link" onClick={svuota}>Ricomincia da zero</button>
        </p>
      )}

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

      {(lista || garanzia) && (
        <div className="capito" role="status">
          <span>
            {lista?.lista === 'spesa' && <>Va nella <b>spesa</b>: {lista.voci.map((v) => v.testo).join(', ')}</>}
            {lista?.lista === 'ristoranti' && <>Va nei <b>ristoranti e posti</b>: {lista.voci[0].testo}{lista.voci[0].voto ? ` (${'★'.repeat(lista.voci[0].voto)})` : ''}</>}
            {garanzia && <>Diventa una <b>garanzia</b>: {garanzia.cosa}{garanzia.negozio ? ` (${garanzia.negozio})` : ''}, {durata(garanzia.mesi)}, fino al {garanzia.fine.toLocaleDateString('it-CH')}</>}
          </span>
          <button type="button" className="tasto-link" onClick={() => setSoloNota(true)}>No, è una nota</button>
        </div>
      )}

      {ditta && (
        <div className="campo">
          <span>Nella scheda</span>
          <div className="chips">
            <span className="chip attivo">
              <a href={`#/azienda/${ditta.id}`}>{ditta.nome}</a>
              <button type="button" aria-label={`Non nella scheda ${ditta.nome}`} onClick={() => setDitta(null)}>
                <Icona nome="x" size={14} />
              </button>
            </span>
          </div>
          {ditta.area !== areaNota && <span className="nota-piccola">Con un'altra area la nota non va nella scheda.</span>}
        </div>
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
