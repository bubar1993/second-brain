import { useEffect, useRef, useState } from 'react'
import { sb, AREE, areaDa, nomePersona, quando, CAMPI_PERSONA } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro, SceltaPersone, Icona, useModifiche } from './componenti'

const FINESTRA = 24 * 3600 * 1000
const nomeContatto = (c) => (c.persone ? nomePersona(c.persone) : c.nome_rubrica || c.nome_profilo || `+${c.wa_id}`)

// Stato del collegamento: finché il numero non è agganciato, lo si dice chiaramente.
function useStatoWhatsApp() {
  const [stato, setStato] = useState(null)
  useEffect(() => {
    sb.from('wa_stato').select('*').maybeSingle().then(({ data }) => setStato(data || { collegato: false }))
  }, [])
  return stato
}

// Elenco chat: chi ha scritto per ultimo in alto. Con un'area scelta, solo quella (e i contatti da smistare).
export function ChatWhatsApp() {
  const { area } = useApp()
  const stato = useStatoWhatsApp()
  const [cerca, setCerca] = useState('')

  const { dati, errore, carica } = useCarica(async () => {
    let q = sb.from('wa_contatti').select('wa_id,area,nome_rubrica,nome_profilo,ultimo_il,ultimo_in_il,persone(id,nome,cognome)')
      .not('ultimo_il', 'is', null).order('ultimo_il', { ascending: false }).limit(300)
    if (area !== 'T') q = q.or(`area.eq.${area},area.is.null`)
    return chk(await q)
  }, [area])

  const testo = cerca.trim().toLowerCase()
  const visibili = (dati || []).filter((c) => !testo || `${nomeContatto(c)} ${c.wa_id}`.toLowerCase().includes(testo))

  return (
    <div className="schermata">
      <Indietro titolo="WhatsApp" />
      {stato && !stato.collegato && (
        <div className="scheda scheda-impronta">
          <p>WhatsApp non è ancora collegato. Si aggancia con il QR dal telefono appena Meta approva la verifica di Ceramex: lo facciamo insieme.</p>
        </div>
      )}
      {stato?.errore && <div className="scheda scheda-allarme"><p>WhatsApp: {stato.errore}</p></div>}
      {stato?.collegato && <a className="riga" href="#/whatsapp/modelli"><span className="riga-corpo"><span className="riga-testo">Modelli di messaggio</span></span><Icona nome="freccia" size={18} /></a>}
      <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca chat" />
      <Stato carica={carica} errore={errore} vuoto={dati && !visibili.length ? 'Nessuna chat.' : null}>
        {dati && (
          <div className="elenco">
            {visibili.map((c) => {
              const a = areaDa(c.area)
              return (
                <a key={c.wa_id} className="riga" href={`#/whatsapp/${c.wa_id}`}>
                  <span className="pallino" style={{ background: a ? a.colore : 'var(--grigio)' }} />
                  <span className="riga-corpo">
                    <span className="riga-testo">{nomeContatto(c)}</span>
                    <span className="riga-meta">{a ? a.nome : 'Da smistare'} · {quando(c.ultimo_il, true)}</span>
                  </span>
                  <Icona nome="freccia" size={18} />
                </a>
              )
            })}
          </div>
        )}
      </Stato>
    </div>
  )
}

// Una chat: messaggi, a chi appartiene (area, persona) e la casella per scrivere (entro 24 ore).
export function ChatContatto({ waId }) {
  const { avvisa } = useApp()
  const [testo, setTesto] = useState('')
  const [conferma, setConferma] = useState(false)
  const [lavoro, setLavoro] = useState(false)
  const fondo = useRef(null)
  useModifiche(!!testo.trim())
  const timer = useRef(null)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [c, m] = await Promise.all([
      sb.from('wa_contatti').select('*,persone(' + CAMPI_PERSONA + ')').eq('wa_id', waId).single(),
      sb.from('wa_messaggi').select('id,direzione,tipo,testo,media,data,stato,errore,trascrizione').eq('wa_id', waId)
        .order('data', { ascending: false }).limit(150),
    ])
    return { c: chk(c), messaggi: chk(m).reverse() }
  }, [waId])

  useEffect(() => { fondo.current?.scrollIntoView({ block: 'end' }) }, [dati])
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!dati) return <div className="schermata"><Indietro titolo="WhatsApp" /><Stato carica={carica} errore={errore} /></div>
  const { c, messaggi } = dati
  const aperta = c.ultimo_in_il && Date.now() - new Date(c.ultimo_in_il).getTime() < FINESTRA

  async function cambia(campi, msg) {
    try {
      chk(await sb.from('wa_contatti').update(campi).eq('wa_id', waId))
      if (msg) avvisa(msg)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  // Due tocchi: il primo chiede conferma, il secondo manda.
  async function manda() {
    if (!testo.trim()) return
    if (!conferma) {
      setConferma(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setConferma(false), 4000)
      return
    }
    clearTimeout(timer.current)
    setConferma(false)
    setLavoro(true)
    try {
      await funzione('invia-whatsapp', { body: { wa_id: waId, testo } })
      setTesto('')
      avvisa('Mandato')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  return (
    <div className="schermata chat-whatsapp">
      <Indietro titolo={nomeContatto(c)} />
      <p className="nota-piccola selezionabile">+{c.wa_id}{c.nome_profilo && c.nome_profilo !== nomeContatto(c) ? ` · «${c.nome_profilo}»` : ''}</p>

      <div className="scelta-area">
        {AREE.map((a) => (
          <button key={a.codice} type="button" style={{ '--c': a.colore }}
            className={'chip chip-area' + (c.area === a.codice ? ' attivo' : '')}
            onClick={() => cambia({ area: c.area === a.codice ? null : a.codice }, c.area === a.codice ? 'Da smistare' : `Chat in ${a.nome}`)}>
            {a.nome}
          </button>
        ))}
      </div>
      <div className="campo">
        <span>Persona</span>
        <SceltaPersone valore={c.persone ? [c.persone] : []}
          onChange={(l) => cambia({ persona_id: l.length ? l[l.length - 1].id : null }, l.length ? 'Collegata' : 'Scollegata')} />
      </div>
      {c.area === 'P' && (
        <label className="interruttore-riga">
          <input type="checkbox" checked={!!c.approfondita} onChange={(e) => cambia({ approfondita: e.target.checked })} />
          Tieni più dettagli su questa persona
        </label>
      )}

      <div className="chat-breve chat-lunga">
        {messaggi.map((m) => (
          <p key={m.id} className={'fumetto ' + (m.direzione === 'out' ? 'mio' : 'suo')}>
            {m.tipo === 'audio'
              ? `🎤 ${m.testo || (m.trascrizione ? '(vocale non trascritto)' : '(vocale, in trascrizione…)')}`
              : m.testo || `(${m.tipo})`}
            <span className="riga-meta">
              {quando(m.data, true)}
              {m.direzione === 'out' && m.stato && ` · ${STATI[m.stato] || m.stato}`}
              {m.errore && <span className="rosso"> · {m.errore}</span>}
            </span>
          </p>
        ))}
        {!messaggi.length && <p className="msg">Ancora nessun messaggio.</p>}
        <span ref={fondo} />
      </div>

      {aperta ? (
        <div className="scrivi-whatsapp">
          <textarea value={testo} onChange={(e) => { setTesto(e.target.value); setConferma(false) }} rows={3} placeholder="Scrivi un messaggio…" />
          <button type="button" className={'tasto-grande' + (conferma ? ' conferma' : '')} onClick={manda} disabled={lavoro || !testo.trim()}>
            {lavoro ? 'Mando…' : conferma ? 'Tocca ancora per mandare' : 'Manda'}
          </button>
        </div>
      ) : (
        <p className="nota-piccola">Sono passate più di 24 ore dal suo ultimo messaggio: WhatsApp permette di scrivere solo dal telefono (o con un modello a pagamento).</p>
      )}
    </div>
  )
}

const STATI = { sent: 'mandato', delivered: 'consegnato', read: 'letto', failed: 'non partito' }

// Chiama una funzione e trasforma la risposta d'errore in un messaggio leggibile.
async function funzione(nome, opzioni) {
  const { data, error } = await sb.functions.invoke(nome, opzioni)
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).errore || msg } catch { /* resta il messaggio */ }
    throw new Error(msg)
  }
  if (data?.errore) throw new Error(data.errore)
  return data
}

const STATI_MODELLO = { APPROVED: 'approvato', PENDING: 'in controllo da Meta', REJECTED: 'rifiutato', PAUSED: 'in pausa', DISABLED: 'disattivato' }

// Modelli: i messaggi approvati da Meta, per scrivere a chi non ha scritto nelle ultime 24 ore.
export function ModelliWhatsApp() {
  const { avvisa } = useApp()
  const [nome, setNome] = useState('')
  const [categoria, setCategoria] = useState('UTILITY')
  const [testo, setTesto] = useState('')
  const [conferma, setConferma] = useState(false)
  const [lavoro, setLavoro] = useState(false)
  const timer = useRef(null)
  useModifiche(!!(nome.trim() || testo.trim()))
  useEffect(() => () => clearTimeout(timer.current), [])

  const { dati, errore, carica, ricarica } = useCarica(async () => (await funzione('whatsapp-modelli', { method: 'GET' })).modelli, [])

  async function crea() {
    if (!nome.trim() || !testo.trim()) return avvisa('Scrivi nome e testo')
    if (!conferma) {
      setConferma(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setConferma(false), 4000)
      return
    }
    clearTimeout(timer.current)
    setConferma(false)
    setLavoro(true)
    try {
      const r = await funzione('whatsapp-modelli', { body: { nome, categoria, testo } })
      avvisa(`Modello «${r.nome}» mandato a Meta per il controllo`)
      setNome('')
      setTesto('')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  return (
    <div className="schermata">
      <Indietro titolo="Modelli WhatsApp" />
      <p className="nota-piccola">Servono per scrivere a chi non ti ha scritto nelle ultime 24 ore. Meta controlla ogni modello prima di approvarlo. Crearlo è gratis; si paga solo quando lo si manda.</p>

      <div className="scheda scheda-modulo">
        <label className="campo">
          Nome
          <input value={nome} onChange={(e) => { setNome(e.target.value); setConferma(false) }} placeholder="es. conferma appuntamento" />
        </label>
        <div className="scelta-area">
          {[['UTILITY', 'Servizio (appuntamenti, ordini)'], ['MARKETING', 'Promozione']].map(([v, t]) => (
            <button key={v} type="button" className={'chip' + (categoria === v ? ' attivo' : '')} onClick={() => setCategoria(v)}>{t}</button>
          ))}
        </div>
        <label className="campo">
          Testo
          <textarea value={testo} onChange={(e) => { setTesto(e.target.value); setConferma(false) }} rows={4}
            placeholder="Buongiorno {{1}}, le confermo l'appuntamento di {{2}} alle {{3}}. Giovanni Fabris" />
        </label>
        <p className="nota-piccola">{'{{1}}'}, {'{{2}}'}… sono le parti che cambiano ogni volta (nome, giorno, ora).</p>
        <button type="button" className={'tasto-grande' + (conferma ? ' conferma' : '')} onClick={crea} disabled={lavoro}>
          {lavoro ? 'Mando…' : conferma ? 'Tocca ancora per mandarlo a Meta' : 'Crea modello'}
        </button>
      </div>

      <Stato carica={carica} errore={errore} vuoto={dati && !dati.length ? 'Ancora nessun modello.' : null}>
        {dati && (
          <div className="elenco">
            {dati.map((m) => (
              <div key={m.id} className="riga">
                <span className="pallino" style={{ background: m.stato === 'APPROVED' ? 'var(--verde, #34d58a)' : m.stato === 'REJECTED' ? 'var(--rosso, #ff6b6b)' : 'var(--grigio)' }} />
                <span className="riga-corpo">
                  <span className="riga-testo">{m.nome}</span>
                  <span className="riga-meta">{STATI_MODELLO[m.stato] || m.stato} · {m.categoria === 'MARKETING' ? 'promozione' : 'servizio'} · {m.lingua}{m.motivo && m.motivo !== 'NONE' ? ` · ${m.motivo}` : ''}</span>
                  <span className="riga-meta">{m.testo}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Stato>
    </div>
  )
}
