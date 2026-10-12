import { useEffect, useRef, useState } from 'react'
import { sb, leggi, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro, Icona, useDettatura, caricaFoto, collegaPersone } from './componenti'

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

  const { dati: e, errore, carica, ricarica } = useCarica(async () => {
    const ev = chk(await sb.from('eventi')
      .select('id,titolo,inizio,fine,luogo,area,azienda_id,aziende(id,nome),persone(id,nome,cognome)').eq('id', id).single())
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
      const giorno = new Date(e.inizio)
      const intestazione = `Appunti visita «${e.titolo}» del ${giorno.toLocaleDateString('it-CH')}`
      const nota = chk(await sb.from('note').insert({
        testo: pulito ? `${intestazione}:\n${pulito}` : intestazione,
        area: e.area || null, azienda_id: e.aziende?.id || null,
        data: giorno.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }),
        fonte: !pulito ? 'foto' : dettata ? 'voce' : 'scritta',
      }).select('id').single())
      if (e.persone) await collegaPersone(nota.id, e.area || null, [e.persone])
      for (const f of foto) await caricaFoto(utente.id, nota.id, f.file)
      chk(await sb.from('eventi').update({ fatto_il: new Date().toISOString(), nota_id: nota.id }).eq('id', id))
      scrivi(chiave(id), '')
      avvisa('Visita salvata: l\'agente la mette nella scheda')
      vai('/oggi')
    } catch (err) {
      avvisa(messaggioErrore(err))
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
              {new Date(e.inizio).toLocaleString('it-CH', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
              {e.luogo ? ` · ${e.luogo}` : ''}
            </p>
            <div className="contatti-persona">
              {e.aziende && <a className="tasto-piccolo" href={`#/azienda/${e.aziende.id}`}>Scheda {e.aziende.nome}</a>}
              {e.persone && <a className="tasto-piccolo" href={`#/persona/${e.persone.id}`}>{[e.persone.nome, e.persone.cognome].filter(Boolean).join(' ')}</a>}
            </div>
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
