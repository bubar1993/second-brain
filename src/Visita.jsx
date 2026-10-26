import { useEffect, useRef, useState } from 'react'
import { sb, leggi, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro, Icona, useDettatura, caricaFoto, collegaPersone, useModifiche, perCampo } from './componenti'

// ---------- Spostare o correggere un appuntamento ----------
// Resta lo STESSO appuntamento: appunti, note e collegamenti non si perdono.
// Quelli di Google Calendar: il cambio va in eventi.cambio, l'app lo mostra subito
// e l'agente calendario lo porta in Google (lo sveglia il portinaio: di giorno entro un'ora, di notte alle 6). Gli altri (proposti, da creare) si cambiano e basta.
export const CAMPI_EVENTO = 'id,google_id,titolo,inizio,fine,tutto_il_giorno,luogo,descrizione,area,stato,motivo,errore,cambio,cambio_il,nota_id,automatico,aziende(id,nome),persone(id,nome,cognome,telefono)'

// Link per entrare in una call (Teams, Zoom, Meet, Webex) scritto nel luogo o nella descrizione (14.10.2026).
const LINK_CALL = /https:\/\/(?:teams\.microsoft\.com\/[^\s<>"']+|[\w.-]*zoom\.us\/j\/[^\s<>"']+|meet\.google\.com\/[a-z-]+|[\w.-]*webex\.com\/[^\s<>"']+)/i
export const linkCall = (e) => `${e.luogo || ''} ${e.descrizione || ''}`.match(LINK_CALL)?.[0] || null

// L'appuntamento come lo vede Giovanni: con il cambio già applicato. "originale" serve per annullare.
export const valoriEvento = (e) => ({ ...e, ...(e.cambio || {}), originale: e })

async function cambiaEvento(e, nuovo) {
  const o = e.originale || e
  if (o.google_id) {
    chk(await sb.from('eventi').update({ cambio: nuovo, cambio_il: new Date().toISOString(), errore: null }).eq('id', o.id))
    return async () => chk(await sb.from('eventi').update({ cambio: o.cambio || null, cambio_il: o.cambio_il || null, errore: o.errore || null }).eq('id', o.id))
  }
  // Correggendo un appuntamento non ancora creato si toglie anche l'errore: così il portinaio lo riprova subito.
  const prima = { titolo: o.titolo, inizio: o.inizio, fine: o.fine, luogo: o.luogo, tutto_il_giorno: o.tutto_il_giorno, errore: o.errore || null }
  chk(await sb.from('eventi').update({ ...nuovo, errore: null }).eq('id', o.id))
  return async () => chk(await sb.from('eventi').update(prima).eq('id', o.id))
}

// Domani, lunedì prossimo o una settimana dopo (dal suo giorno, o da oggi se è già passato),
// alla stessa ora e con la stessa durata.
function spostato(e, quando) {
  const inizio = new Date(e.inizio)
  const d = new Date()
  if (quando === 'domani') d.setDate(d.getDate() + 1)
  else if (quando === 'lunedi') d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  else {
    if (inizio > d) d.setTime(inizio.getTime())
    d.setDate(d.getDate() + 7)
  }
  d.setHours(inizio.getHours(), inizio.getMinutes(), 0, 0)
  return d
}
const DURATA = (e) => (e.fine ? new Date(e.fine) - new Date(e.inizio) : 3600000)
const RIMANDA = [['domani', 'Domani'], ['lunedi', 'Lunedì'], ['settimana', 'Una settimana dopo']]
const giornoCampo = (iso) => perCampo(iso).slice(0, 10)

export function ModificaAppuntamento({ e, fatto, chiudi }) {
  const { avvisa } = useApp()
  const [titolo, setTitolo] = useState(e.titolo || '')
  const [inizio, setInizio] = useState(e.tutto_il_giorno ? giornoCampo(e.inizio) : perCampo(e.inizio))
  const [fine, setFine] = useState(e.tutto_il_giorno ? '' : perCampo(e.fine || new Date(new Date(e.inizio).getTime() + 3600000)))
  const [luogo, setLuogo] = useState(e.luogo || '')
  const [lavoro, setLavoro] = useState(false)
  const iniziale = { titolo: e.titolo || '', inizio: e.tutto_il_giorno ? giornoCampo(e.inizio) : perCampo(e.inizio), luogo: e.luogo || '' }
  const fineIniziale = e.tutto_il_giorno ? '' : perCampo(e.fine || new Date(new Date(e.inizio).getTime() + 3600000))
  const cambiato = titolo.trim() !== iniziale.titolo || inizio !== iniziale.inizio || fine !== fineIniziale || luogo.trim() !== iniziale.luogo
  useModifiche(cambiato)

  // Cambiando l'inizio, la fine si sposta con lui (stessa durata).
  function nuovoInizio(v) {
    if (!e.tutto_il_giorno && v && inizio && fine) {
      const durata = new Date(fine) - new Date(inizio)
      setFine(perCampo(new Date(new Date(v).getTime() + Math.max(durata, 0))))
    }
    setInizio(v)
  }

  async function applica(nuovo, messaggio) {
    setLavoro(true)
    try {
      const annulla = await cambiaEvento(e, nuovo)
      const google = !!(e.originale || e).google_id
      avvisa(google ? `${messaggio}: in Google entro un'ora` : messaggio, {
        etichetta: 'Annulla',
        fai: async () => {
          try { await annulla(); avvisa('Come prima'); fatto() } catch (err) { avvisa(messaggioErrore(err)) }
        },
      })
      chiudi?.()
      fatto()
    } catch (err) {
      avvisa(messaggioErrore(err))
    } finally {
      setLavoro(false)
    }
  }

  function salva() {
    if (!titolo.trim()) return avvisa('Il titolo serve')
    if (!inizio) return avvisa('Scegli quando')
    let i, f
    if (e.tutto_il_giorno) {
      i = new Date(`${inizio}T00:00`)
      f = new Date(i.getTime() + DURATA(e))
    } else {
      i = new Date(inizio)
      f = fine ? new Date(fine) : new Date(i.getTime() + DURATA(e))
      if (f <= i) return avvisa('La fine deve venire dopo l\'inizio')
    }
    applica({ titolo: titolo.trim(), inizio: i.toISOString(), fine: f.toISOString(), luogo: luogo.trim() || null, tutto_il_giorno: !!e.tutto_il_giorno }, 'Appuntamento cambiato')
  }

  function rimanda(k) {
    const i = spostato(e, k)
    applica({ titolo: e.titolo, inizio: i.toISOString(), fine: new Date(i.getTime() + DURATA(e)).toISOString(), luogo: e.luogo || null, tutto_il_giorno: !!e.tutto_il_giorno },
      `Spostato a ${i.toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'short' })}`)
  }

  return (
    <div className="modifica-promemoria">
      <label className="campo">
        Titolo
        <input type="text" value={titolo} onChange={(x) => setTitolo(x.target.value)} />
      </label>
      {e.tutto_il_giorno ? (
        <label className="campo">
          Giorno
          <input type="date" value={inizio} onChange={(x) => setInizio(x.target.value)} />
        </label>
      ) : (
        <div className="due">
          <label className="campo">Inizio<input type="datetime-local" value={inizio} onChange={(x) => nuovoInizio(x.target.value)} /></label>
          <label className="campo">Fine<input type="datetime-local" value={fine} onChange={(x) => setFine(x.target.value)} /></label>
        </div>
      )}
      <label className="campo">
        Luogo
        <input type="text" value={luogo} onChange={(x) => setLuogo(x.target.value)} placeholder="nessuno" />
      </label>
      <div className="chips">
        <span className="nota-piccola">Rimanda a:</span>
        {RIMANDA.map(([k, nome]) => (
          <button key={k} type="button" className="chip" disabled={lavoro} onClick={() => rimanda(k)}>{nome}</button>
        ))}
      </div>
      <div className="azioni">
        {cambiato && <button type="button" className="tasto-piccolo tasto-salva" onClick={salva} disabled={lavoro}>Salva</button>}
        {chiudi && <button type="button" className="tasto-link" onClick={chiudi}>Chiudi</button>}
      </div>
      {(e.originale || e).google_id && (
        <p className="nota-piccola">Resta lo stesso appuntamento: appunti e note non si perdono. In Google Calendar lo sposta l'agente entro un'ora.</p>
      )}
    </div>
  )
}

// "Prendi appunti" durante un appuntamento (#/visita/<id evento>).
// Il testo si salva sul telefono mentre scrivi (non si perde se esci dall'app o il telefono si blocca).
// "Fine visita": diventa UNA nota collegata a ditta e persona; l'agente lavoro la divide nelle sezioni della scheda.
const chiave = (id) => `visita:${id}`

export function bozzaVisita(id) {
  try { return JSON.parse(leggi(chiave(id)) || 'null') } catch { return null }
}

// Appunti cominciati e non finiti (per l'avviso in Oggi).
export function visiteAperte() {
  const aperte = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith('visita:')) continue
      const b = bozzaVisita(k.slice(7))
      if (b?.testo?.trim()) aperte.push({ id: k.slice(7), ...b })
    }
  } catch { /* niente */ }
  return aperte
}

export function Visita({ id }) {
  const { avvisa, vai, utente } = useApp()
  const [testo, setTesto] = useState(() => bozzaVisita(id)?.testo || '')
  const [foto, setFoto] = useState([])
  const [dettata, setDettata] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [salvataIl, setSalvataIl] = useState(null)
  const scattaRif = useRef(null)
  const notaFatta = useRef(null)

  const [cambia, setCambia] = useState(false)
  const { dati: e, errore, carica, ricarica } = useCarica(async () => {
    // Con il cambio già applicato (spostato dall'app, in arrivo in Google).
    const ev = valoriEvento(chk(await sb.from('eventi')
      .select(CAMPI_EVENTO + ',azienda_id,fatto_il').eq('id', id).single()))
    // Senza ditta: cerco quelle che hanno nel nome una parola del titolo ("2cm somazzi" → Somazzi…).
    let candidate = []
    if (!ev.aziende) {
      const parole = ev.titolo.toLowerCase().split(/[^a-zà-ü]+/i).filter((p) => p.length >= 4)
      if (parole.length) {
        candidate = chk(await sb.from('aziende').select('id,nome,area').is('eliminata_il', null).is('unito_in', null)
          .or(parole.map((p) => `nome.ilike.%${p}%`).join(',')).limit(5))
      }
    }
    return { ...ev, candidate }
  }, [id])

  // Salva sul telefono poco dopo ogni modifica, e subito se esci dall'app.
  const ultimo = useRef(testo)
  ultimo.current = testo
  useEffect(() => {
    const salva = () => {
      scrivi(chiave(id), JSON.stringify({ testo: ultimo.current, titolo: e?.titolo || '', ora: Date.now() }))
      setSalvataIl(new Date())
    }
    const t = setTimeout(salva, 800)
    const via = () => { if (document.hidden) salva() }
    document.addEventListener('visibilitychange', via)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', via) }
  }, [testo, id, e?.titolo])

  const dettatura = useDettatura((t) => {
    setTesto((x) => (x.trim() ? x.trimEnd() + ' ' : '') + t)
    setDettata(true)
  })

  async function scegliDitta(d) {
    try {
      chk(await sb.from('eventi').update({ azienda_id: d.id, area: e.area || d.area }).eq('id', id))
      ricarica()
    } catch (err) {
      avvisa(messaggioErrore(err))
    }
  }

  async function fine() {
    const pulito = testo.trim()
    if (!pulito && !foto.length) return avvisa('Scrivi qualcosa o aggiungi una foto')
    setSalvo(true)
    try {
      // Nota già creata a un tentativo prima (foto non partita): non la rifaccio.
      let nota = notaFatta.current
      if (!nota) {
        const giorno = new Date(e.inizio)
        const intestazione = `Appunti visita «${e.titolo}» del ${giorno.toLocaleDateString('it-CH')}`
        nota = chk(await sb.from('note').insert({
          testo: pulito ? `${intestazione}:\n${pulito}` : intestazione,
          area: e.area || null, azienda_id: e.aziende?.id || null,
          data: giorno.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }),
          fonte: !pulito ? 'foto' : dettata ? 'voce' : 'scritta',
        }).select('id').single())
        notaFatta.current = nota
        if (e.persone) await collegaPersone(nota.id, e.area || null, [e.persone])
      }
      for (const f of foto) {
        await caricaFoto(utente.id, nota.id, f.file)
        setFoto((x) => x.filter((y) => y !== f))
      }
      chk(await sb.from('eventi').update({ fatto_il: new Date().toISOString(), nota_id: nota.id }).eq('id', id))
      scrivi(chiave(id), '')
      avvisa('Visita salvata: l\'agente la mette nella scheda')
      vai('/oggi')
    } catch (err) {
      avvisa(notaFatta.current ? `Appunti salvati, ma una foto non è partita: tocca Fine visita per riprovare. (${messaggioErrore(err)})` : messaggioErrore(err))
      setSalvo(false)
    }
  }

  return (
    <div className="schermata visita aggiungi-schermata">
      <Indietro titolo={e ? e.titolo : 'Appunti'} />
      <Stato carica={carica} errore={errore}>
        {e && (
          <>
            <p className="nota-piccola">
              {new Date(e.inizio).toLocaleString('it-CH', { weekday: 'long', day: 'numeric', month: 'long', ...(e.tutto_il_giorno ? {} : { hour: '2-digit', minute: '2-digit' }) })}
              {e.luogo ? ` · ${e.luogo}` : ''}
              {e.originale.cambio && ' · spostato, in arrivo nel calendario'}
              {' '}<button type="button" className="tasto-link" onClick={() => setCambia(!cambia)} aria-expanded={cambia}>
                {cambia ? 'Chiudi' : 'Sposta o cambia'}
              </button>
            </p>
            {e.errore && <p className="nota-piccola rosso">{e.errore}</p>}
            {cambia && <ModificaAppuntamento e={e} fatto={ricarica} chiudi={() => setCambia(false)} />}
            <div className="contatti-persona">
              {e.aziende && <a className="tasto-piccolo" href={`#/azienda/${e.aziende.id}`}>Scheda {e.aziende.nome}</a>}
              {e.persone && <a className="tasto-piccolo" href={`#/persona/${e.persone.id}`}>{[e.persone.nome, e.persone.cognome].filter(Boolean).join(' ')}</a>}
            </div>
            {e.nota_id && (
              <p className="nota-piccola">
                Appunti già salvati: <a className="link-persona" href={`#/nota/${e.nota_id}`}>apri la nota</a>. Se scrivi ancora, diventa una nota in più.
              </p>
            )}
            {!e.aziende && e.candidate.length > 0 && (
              <div className="campo">
                <span>Quale ditta?</span>
                <div className="chips">
                  {e.candidate.map((d) => (
                    <button key={d.id} type="button" className="chip" onClick={() => scegliDitta(d)}>{d.nome}</button>
                  ))}
                </div>
              </div>
            )}

            <textarea value={testo} onChange={(x) => setTesto(x.target.value)} rows={12}
              placeholder="Scrivi o detta durante la visita: campioni, prezzi, problemi, cosa hai promesso…" />
            <p className="nota-piccola">{salvataIl ? `Salvato sul telefono alle ${salvataIl.toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })}` : 'Si salva da solo mentre scrivi'}</p>

            <div className="strumenti">
              {dettatura.supportata && (
                <button type="button" className={'tasto-tondo' + (dettatura.attiva ? ' ascolta' : '')}
                  onClick={dettatura.attiva ? dettatura.ferma : dettatura.avvia}>
                  <Icona nome="mic" /><span>{dettatura.attiva ? 'Ascolto…' : 'Parla'}</span>
                </button>
              )}
              <button type="button" className="tasto-tondo" onClick={() => scattaRif.current?.click()}>
                <Icona nome="foto" /><span>Foto</span>
              </button>
              <input ref={scattaRif} type="file" accept="image/*" multiple hidden
                onChange={(x) => { setFoto((f) => [...f, ...[...x.target.files].map((file) => ({ file, url: URL.createObjectURL(file) }))]); x.target.value = '' }} />
            </div>
            {foto.length > 0 && (
              <>
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
                <p className="nota-piccola">Le foto si salvano con "Fine visita": non uscire dall'app prima.</p>
              </>
            )}

            <button type="button" className="tasto-grande" onClick={fine} disabled={salvo}>
              {salvo ? 'Salvo…' : 'Fine visita'}
            </button>
          </>
        )}
      </Stato>
    </div>
  )
}
