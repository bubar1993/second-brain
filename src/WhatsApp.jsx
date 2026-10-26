import { useEffect, useRef, useState } from 'react'
import { sb, AREE, areaDa, nomePersona, quando, CAMPI_PERSONA } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro, SceltaPersone, Icona, useModifiche, useDueTocchi } from './componenti'

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

// Il numero di prova di Meta (+1 555 645 6202) non conta come collegato: serve il numero vero di Giovanni.
const numeroDiProva = (n) => /^\+?1[\s-]*555/.test(String(n || ''))

// ---- Collega WhatsApp (26.10.2026, dopo l'approvazione di Meta del 25.10) ----
// Iscrizione integrata di Meta in coesistenza: il numero resta nell'app WhatsApp Business del telefono (QR).
// FB.login con la configurazione "ES Config" → codice (vale pochi secondi) + account e numero dal messaggio
// WA_EMBEDDED_SIGNUP; poi subito whatsapp-collega (con l'accesso di Giovanni) che salva il collegamento e chiede
// contatti e storico di 6 mesi (una volta sola, entro 24 ore). Mai "numero nuovo" o "virtuale".
// Portfolio «Giovanni Fabris WhatsApp», non Ceramex: con Ceramex (proprietario dell'app) Meta si ferma
// all'ultimo passo e il numero resta DISCONNECTED (prova del 26.10.2026).
const APP_META = '1050142621357706'
const CONFIG_META = '1143212528277399'
function caricaSdkMeta() {
  if (window.FB) return Promise.resolve(window.FB)
  if (window.__sdkMeta) return window.__sdkMeta
  window.__sdkMeta = new Promise((ok, no) => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId: APP_META, autoLogAppEvents: true, xfbml: false, version: 'v26.0' })
      ok(window.FB)
    }
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/it_IT/sdk.js'
    s.async = true
    s.crossOrigin = 'anonymous'
    s.onerror = () => { window.__sdkMeta = null; no(new Error('Non riesco a caricare la pagina di Meta')) }
    document.body.appendChild(s)
  })
  return window.__sdkMeta
}
export function CollegaWhatsApp() {
  const stato = useStatoWhatsApp()
  const [fase, setFase] = useState('pronto') // pronto | meta | salvo | fatto | errore
  const [messaggio, setMessaggio] = useState('')
  const [esito, setEsito] = useState(null)
  const ids = useRef({})
  const codice = useRef(null)
  const mandato = useRef(false)

  async function completa() {
    if (mandato.current || !codice.current) return
    mandato.current = true
    setFase('salvo')
    try {
      const { data, error } = await sb.functions.invoke('whatsapp-collega', {
        body: { code: codice.current, waba_id: ids.current.waba_id, phone_number_id: ids.current.phone_number_id },
      })
      if (error) {
        let testo = error.message
        try { testo = (await error.context.json()).errore || testo } catch { /* risposta senza dettagli */ }
        throw new Error(testo)
      }
      setEsito(data.fatto || {})
      setFase('fatto')
    } catch (e) {
      setMessaggio(messaggioErrore(e))
      setFase('errore')
    }
  }

  // Meta manda account e numero con un messaggio alla pagina (sessionInfoVersion 3).
  useEffect(() => {
    const ascolta = (e) => {
      let host = ''
      try { host = new URL(e.origin).hostname } catch { return }
      if (!/(^|\.)facebook\.com$/.test(host)) return
      let d
      try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
      if (!d || d.type !== 'WA_EMBEDDED_SIGNUP') return
      if (String(d.event).startsWith('FINISH')) {
        ids.current = { waba_id: d.data?.waba_id, phone_number_id: d.data?.phone_number_id }
        if (codice.current) completa()
      } else if (d.event === 'CANCEL') {
        setMessaggio(d.data?.current_step ? `Interrotto da Meta (passo: ${d.data.current_step}).` : 'Interrotto.')
        setFase('pronto')
      } else if (d.event === 'ERROR') {
        setMessaggio(d.data?.error_message || 'Errore nella finestra di Meta.')
        setFase('errore')
      }
    }
    window.addEventListener('message', ascolta)
    return () => window.removeEventListener('message', ascolta)
  }, [])

  async function apri() {
    setMessaggio('')
    mandato.current = false
    codice.current = null
    ids.current = {}
    let FB
    try { FB = await caricaSdkMeta() } catch (e) { setMessaggio(e.message); setFase('errore'); return }
    setFase('meta')
    FB.login((r) => {
      const code = r && r.authResponse && r.authResponse.code
      if (!code) { setFase((f) => (f === 'meta' ? 'pronto' : f)); setMessaggio((m) => m || 'Finestra di Meta chiusa senza collegare.'); return }
      codice.current = code
      // Se il messaggio con account e numero non arriva, dopo 3 secondi si va lo stesso: li trova la funzione.
      if (ids.current.waba_id) completa()
      else setTimeout(completa, 3000)
    }, {
      config_id: CONFIG_META, response_type: 'code', override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
    })
  }

  const giaCollegato = stato && stato.collegato && !numeroDiProva(stato.numero)
  return (
    <div className="schermata">
      <Indietro titolo="Collega WhatsApp" />
      {giaCollegato && fase !== 'fatto' && (
        <div className="scheda">
          <p>Il numero <b>{stato.numero}</b> risulta collegato (dal {quando(stato.collegato_il, true)}).</p>
          <p>Se i messaggi non arrivano nel Brain, prima scollegalo dal telefono: WhatsApp Business → <b>Impostazioni</b> → <b>Account</b> → <b>Piattaforma aziendale</b> → <b>Disconnetti</b>. Poi rifai i passi qui sotto.</p>
        </div>
      )}
      {fase !== 'fatto' && (
        <div className="scheda">
          <p><b>Serve:</b> questo PC e il telefono con WhatsApp Business, 10 minuti.</p>
          <ol>
            <li>Tocca "Apri Meta" qui sotto: si apre la finestra di Meta.</li>
            <li>Scegli il portfolio <b>«Giovanni Fabris WhatsApp»</b> (non Ceramex), crea un <b>nuovo account WhatsApp</b> e scegli <b>"Collega l'app WhatsApp Business"</b>. Mai "numero nuovo" o "virtuale".</li>
            <li>Sul telefono, in WhatsApp Business, inquadra il QR che compare e conferma la condivisione della cronologia.</li>
            <li>Torna qui: il resto lo fa il Brain da solo.</li>
          </ol>
        </div>
      )}
      {fase === 'pronto' || fase === 'errore' ? (
        <button type="button" className="tasto-grande" onClick={apri}>Apri Meta</button>
      ) : null}
      {fase === 'meta' && <p className="nota-piccola">Finestra di Meta aperta: segui i passi lì. Se non la vedi, guarda se il browser ha bloccato la finestra.</p>}
      {fase === 'salvo' && <p className="nota-piccola">Salvo il collegamento e chiedo a Meta contatti e messaggi…</p>}
      {messaggio && <div className={'scheda' + (fase === 'errore' ? ' scheda-allarme' : '')}><p>{messaggio}</p></div>}
      {fase === 'fatto' && (
        <div className="scheda">
          <p><b>Collegato{esito?.numero?.display_phone_number ? `: ${esito.numero.display_phone_number}` : ''}.</b></p>
          <p>Contatti e messaggi degli ultimi 6 mesi stanno arrivando da Meta (può volerci un po'). Gli agenti li metteranno nelle schede giuste.</p>
          <a className="tasto-piccolo" href="#/whatsapp">Vai alle chat</a>
        </div>
      )}
    </div>
  )
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
      {stato && (!stato.collegato || numeroDiProva(stato.numero)) && (
        <div className="scheda scheda-impronta">
          <p>Il tuo numero WhatsApp non è ancora collegato.</p>
          <a className="tasto-grande" href="#/whatsapp/collega">Collega WhatsApp</a>
        </div>
      )}
      {stato?.errore && <div className="scheda scheda-allarme"><p>WhatsApp: {stato.errore}</p></div>}
      {stato?.collegato && <a className="riga" href="#/whatsapp/modelli"><span className="riga-corpo"><span className="riga-testo">Modelli di messaggio</span></span><Icona nome="freccia" size={18} /></a>}
      {stato?.collegato && !numeroDiProva(stato.numero) && <a className="riga" href="#/whatsapp/collega"><span className="riga-corpo"><span className="riga-testo">Collega di nuovo WhatsApp</span></span><Icona nome="freccia" size={18} /></a>}
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
  const due = useDueTocchi()
  const conferma = due.armato === 'manda'
  const setConferma = () => due.disarma()
  const [lavoro, setLavoro] = useState(false)
  const fondo = useRef(null)
  useModifiche(!!testo.trim())

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [c, m] = await Promise.all([
      sb.from('wa_contatti').select('*,persone(' + CAMPI_PERSONA + ')').eq('wa_id', waId).single(),
      sb.from('wa_messaggi').select('id,direzione,tipo,testo,media,data,stato,errore,trascrizione').eq('wa_id', waId)
        .order('data', { ascending: false }).limit(150),
    ])
    return { c: chk(c), messaggi: chk(m).reverse() }
  }, [waId])

  useEffect(() => { fondo.current?.scrollIntoView({ block: 'end' }) }, [dati])

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

  // Due tocchi: il primo chiede conferma, il secondo manda (useDueTocchi).
  function manda() {
    if (!testo.trim()) return
    due.tocca('manda', mandaDavvero)
  }
  async function mandaDavvero() {
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
  const due = useDueTocchi()
  const conferma = due.armato === 'crea'
  const setConferma = () => due.disarma()
  const [lavoro, setLavoro] = useState(false)
  useModifiche(!!(nome.trim() || testo.trim()))

  const { dati, errore, carica, ricarica } = useCarica(async () => (await funzione('whatsapp-modelli', { method: 'GET' })).modelli, [])

  async function crea() {
    if (!nome.trim() || !testo.trim()) return avvisa('Scrivi nome e testo')
    due.tocca('crea', creaDavvero)
  }
  async function creaDavvero() {
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
