import { useCallback, useEffect, useRef, useState } from 'react'
import { sb, AREE, areaDa, leggi, scrivi } from './supabase'
import { AppCtx, Icona, useLargo, haModifiche } from './componenti'
import Accesso from './Accesso'
import Consenso from './Consenso'
import Oggi from './Oggi'
import Aggiungi from './Aggiungi'
import Chiedi from './Chiedi'
import { Dentro, Inbox, ElencoNote, Cestino } from './Dentro'
import { Persone, Persona } from './Persone'
import Nota from './Nota'
import { Aziende, Azienda } from './Aziende'
import { Bozze, Bozza, Mail } from './Bozze'
import { Domande } from './Domande'
import { Gemelli } from './Gemelli'
import { Visita } from './Visita'
import { ChatWhatsApp, ChatContatto, ModelliWhatsApp } from './WhatsApp'

export default function App({ condiviso }) {
  const [sessione, setSessione] = useState(undefined)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSessione(data.session))
    const { data } = sb.auth.onAuthStateChange((_evento, s) => setSessione(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (sessione === undefined) return <div className="avvio" />
  if (!sessione) return <Accesso />
  if (location.pathname === '/oauth/consent') return <Consenso />
  return <Guscio utente={sessione.user} condiviso={condiviso} />
}

function leggiRotta() {
  const h = location.hash.replace(/^#/, '') || '/oggi'
  const [percorso, query = ''] = h.split('?')
  return { parti: percorso.split('/').filter(Boolean), query: new URLSearchParams(query) }
}

function Guscio({ utente, condiviso }) {
  const [rotta, setRotta] = useState(leggiRotta)
  const [area, setAreaStato] = useState(() => leggi('area') || 'T')
  const [avviso, setAvviso] = useState(null)
  const [inbox, setInbox] = useState(0)
  const timer = useRef(null)
  // Il testo condiviso da un'altra app si usa una volta sola.
  const daCondividere = useRef(condiviso)
  const usaCondiviso = () => {
    const c = daCondividere.current
    daCondividere.current = null
    return c
  }

  // Passi fatti dentro l'app: servono al tasto Dentro per tornare indietro senza uscire dall'app.
  // Ogni pagina della cronologia ha un suo segno: tornando indietro si ritrova la posizione nella lista;
  // una pagina nuova parte dall'alto.
  const passi = useRef(0)
  useEffect(() => {
    try { history.scrollRestoration = 'manual' } catch { /* niente */ }
    const segna = () => { const k = `${Date.now()}-${Math.random()}`; history.replaceState({ k }, ''); return k }
    let attuale = history.state?.k || segna()
    const posizioni = {}
    const ricorda = () => { posizioni[attuale] = window.scrollY }
    // La lista può arrivare dopo (dati dalla rete): riprovo per 2 secondi, smetto se tocchi lo schermo.
    let fino = 0
    const ferma = () => { fino = 0 }
    const ritorna = (y) => {
      fino = Date.now() + 2000
      const prova = () => {
        window.scrollTo(0, y)
        if (Math.abs(window.scrollY - y) > 2 && Date.now() < fino) requestAnimationFrame(prova)
      }
      prova()
    }
    const cambia = () => {
      passi.current++
      const nuova = !history.state?.k
      attuale = nuova ? segna() : history.state.k
      setRotta(leggiRotta())
      if (nuova) { fino = 0; window.scrollTo(0, 0) } else ritorna(posizioni[attuale] || 0)
    }
    window.addEventListener('scroll', ricorda, { passive: true })
    window.addEventListener('touchstart', ferma, { passive: true })
    window.addEventListener('wheel', ferma, { passive: true })
    window.addEventListener('hashchange', cambia)
    return () => {
      window.removeEventListener('scroll', ricorda)
      window.removeEventListener('touchstart', ferma)
      window.removeEventListener('wheel', ferma)
      window.removeEventListener('hashchange', cambia)
    }
  }, [])

  const setArea = (a) => { setAreaStato(a); scrivi('area', a) }
  // Avviso in basso; con un'azione (es. "Annulla") resta qualche secondo in più.
  const avvisa = useCallback((testo, azione = null) => {
    clearTimeout(timer.current)
    setAvviso({ testo, azione })
    timer.current = setTimeout(() => setAvviso(null), azione ? 5000 : 2600)
  }, [])
  const vai = (percorso) => { location.hash = percorso }

  // Il telefono tiene l'app aperta per ore: quando torna in primo piano dopo più di 2 minuti
  // si rileggono i dati (e se è uscita una versione nuova dell'app, si carica quella).
  const [giro, setGiro] = useState(0)
  useEffect(() => {
    let nascosta = 0
    async function cambia() {
      if (document.hidden) { nascosta = Date.now(); return }
      // Di ritorno da una telefonata partita dalla scheda persona (almeno 15 secondi, al massimo 3 ore):
      // apri la nota già collegata alla persona, così detti subito com'è andata.
      try {
        const c = JSON.parse(leggi('chiamata') || 'null')
        if (c) {
          scrivi('chiamata', '')
          const durata = Date.now() - c.ora
          if (durata > 15000 && durata < 3 * 3600e3) { location.hash = `/aggiungi?persona=${c.id}&chiamata=1`; return }
        }
      } catch { scrivi('chiamata', '') }
      if (!nascosta || Date.now() - nascosta < 120000) return
      nascosta = 0
      // Stavi correggendo qualcosa (bozza, nota, persona, messaggio…): la schermata resta com'è.
      if (haModifiche()) return
      try {
        const pagina = await (await fetch(`/?versione=${Date.now()}`, { cache: 'no-store' })).text()
        const mio = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src')
        // Mai mentre stai scrivendo una nota.
        if (mio && !pagina.includes(mio) && !/^#\/(aggiungi|visita)/.test(location.hash)) { location.reload(); return }
      } catch { /* senza rete: si rileggono solo i dati */ }
      setGiro((g) => g + 1)
    }
    document.addEventListener('visibilitychange', cambia)
    return () => document.removeEventListener('visibilitychange', cambia)
  }, [])

  // Numero di cose nell'Inbox e di bozze da approvare, aggiornati a ogni cambio schermata.
  const [bozze, setBozze] = useState(0)
  const [domande, setDomande] = useState(0)
  useEffect(() => {
    sb.from('note').select('id', { count: 'exact', head: true })
      .is('area', null).is('eliminata_il', null)
      .then(({ count }) => setInbox(count || 0))
    // Bozze da approvare dell'area scelta (G&C da info@, Ceramex dalla Gmail).
    let qb = sb.from('bozze').select('id', { count: 'exact', head: true }).eq('stato', 'proposta')
    if (area !== 'T') qb = qb.eq('area', area)
    qb.then(({ count }) => setBozze(count || 0))
    // Le domande contano come nella loro schermata: quelle dell'area scelta più quelle senza area.
    let qd = sb.from('domande').select('id', { count: 'exact', head: true }).is('risposta_il', null)
      .or(`mostra_dal.is.null,mostra_dal.lte.${new Date().toISOString()}`)
    if (area !== 'T') qd = qd.or(`area.eq.${area},area.is.null`)
    qd.then(({ count }) => setDomande(count || 0))
  }, [rotta, giro, area])

  const largo = useLargo()
  const [primo, secondo] = rotta.parti
  let schermata
  // Sul PC: elenco aziende a sinistra e scheda a destra, come la posta.
  if (largo && (primo === 'aziende' || primo === 'azienda')) {
    schermata = (
      <div className="diviso">
        <div className="diviso-elenco"><Aziende scelta={primo === 'azienda' ? secondo : null} /></div>
        <div className="diviso-scheda">
          {primo === 'azienda' ? <Azienda key={secondo} id={secondo} cantiere={rotta.query.get('cantiere')} /> : <p className="msg vuoto-diviso">Scegli un'azienda a sinistra.</p>}
        </div>
      </div>
    )
  } else if (largo && (primo === 'bozze' || primo === 'bozza')) {
    schermata = (
      <div className="diviso">
        <div className="diviso-elenco"><Bozze key={bozze} scelta={primo === 'bozza' ? secondo : null} /></div>
        <div className="diviso-scheda">
          {primo === 'bozza' ? <Bozza key={secondo} id={secondo} /> : <p className="msg vuoto-diviso">Scegli una bozza a sinistra.</p>}
        </div>
      </div>
    )
  } else switch (primo) {
    case 'aggiungi': schermata = <Aggiungi key={rotta.query.toString()} usaCondiviso={usaCondiviso} personaId={rotta.query.get('persona')}
      aziendaId={rotta.query.get('azienda')} chiamata={rotta.query.has('chiamata')} />; break
    case 'chiedi': schermata = <Chiedi />; break
    case 'dentro': schermata = <Dentro inbox={inbox} bozze={bozze} domande={domande} />; break
    case 'inbox': schermata = <Inbox />; break
    case 'note': schermata = <ElencoNote />; break
    case 'cestino': schermata = <Cestino />; break
    case 'persone': schermata = <Persone />; break
    case 'persona': schermata = <Persona key={secondo} id={secondo} />; break
    case 'aziende': schermata = <Aziende />; break
    case 'azienda': schermata = <Azienda key={secondo} id={secondo} cantiere={rotta.query.get('cantiere')} />; break
    case 'nota': schermata = <Nota key={secondo} id={secondo} />; break
    case 'bozze': schermata = <Bozze />; break
    case 'bozza': schermata = <Bozza key={secondo} id={secondo} />; break
    case 'mail': schermata = <Mail key={secondo} chiave={secondo} />; break
    case 'domande': schermata = <Domande />; break
    case 'gemelli': schermata = <Gemelli />; break
    case 'visita': schermata = <Visita key={secondo} id={secondo} />; break
    case 'whatsapp': schermata = secondo === 'modelli' ? <ModelliWhatsApp /> : secondo ? <ChatContatto key={secondo} waId={secondo} /> : <ChatWhatsApp />; break
    default: schermata = <Oggi inbox={inbox} bozze={bozze} domande={domande} />
  }
  const tasto = ['oggi', 'aggiungi', 'chiedi'].includes(primo) ? primo : primo ? null : 'oggi'
  const sezioneLato = primo === 'azienda' ? 'aziende' : primo === 'persona' ? 'persone' : primo === 'bozza' ? 'bozze' : primo || 'oggi'

  // Ritoccando Oggi quando ci sei già: torna in cima alla pagina.
  const inCima = (e) => {
    if (tasto !== 'oggi') return
    e.preventDefault()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function esci() {
    scrivi('impronta-rimandata', '')
    await sb.auth.signOut()
  }

  return (
    <AppCtx.Provider value={{ area, setArea, avvisa, vai, utente }}>
      {/* Menu a sinistra: si vede solo sul PC (stile.css). */}
      <nav className="lato" aria-label="Menu">
        <a href="#/oggi" className="marchio">Second Brain</a>
        <a href="#/aggiungi" className={'lato-aggiungi' + (sezioneLato === 'aggiungi' ? ' attivo' : '')}>
          <Icona nome="piu" size={20} /><span>Aggiungi</span>
        </a>
        {[['oggi', 'Oggi'], ['chiedi', 'Chiedi'], null, ['aziende', 'Aziende'], ['bozze', 'Bozze'], ['persone', 'Persone'], ['gemelli', 'Gemelli'], ['whatsapp', 'WhatsApp'],
          ['domande', 'Domande per te'], ['inbox', 'Inbox'], ['note', 'Tutte le note'], ['cestino', 'Cestino']].map((v, i) => v ? (
          <a key={v[0]} href={`#/${v[0]}`} className={'lato-voce' + (sezioneLato === v[0] ? ' attivo' : '')}
            onClick={v[0] === 'oggi' ? inCima : undefined}>
            <Icona nome={v[0] === 'chiedi' ? 'cerca' : v[0]} size={20} /><span>{v[1]}</span>
            {v[0] === 'inbox' && inbox > 0 && <span className="lato-badge">{inbox}</span>}
            {v[0] === 'bozze' && bozze > 0 && <span className="lato-badge">{bozze}</span>}
            {v[0] === 'domande' && domande > 0 && <span className="lato-badge">{domande}</span>}
          </a>
        ) : <hr key={i} />)}
        <button type="button" className="lato-voce lato-esci" onClick={esci}><Icona nome="esci" size={20} /><span>Esci</span></button>
      </nav>

      <header className="barra">
        <div className="interruttore" role="group" aria-label="Aree"
          style={{ '--i': ['T', ...AREE.map((a) => a.codice)].indexOf(area), '--cur': area === 'T' ? 'var(--testo)' : areaDa(area).colore }}>
          <span className="cursore" aria-hidden="true" />
          <button type="button" className={area === 'T' ? 'attivo' : ''} onClick={() => setArea('T')}>Tutte</button>
          {AREE.map((a) => (
            <button key={a.codice} type="button" style={{ '--c': a.colore }}
              className={'area' + (area === a.codice ? ' attivo' : '')}
              onClick={() => setArea(a.codice)} aria-label={a.nome} title={a.nome}>
              {a.codice}
            </button>
          ))}
        </div>
        {/* Ritoccato quando sei già in Dentro: torna dove eri (o a Oggi). */}
        <a href="#/dentro" className={'tasto-dentro' + (primo === 'dentro' ? ' attivo' : '')} aria-label={primo === 'dentro' ? 'Chiudi Dentro' : 'Dentro'}
          onClick={(e) => {
            if (primo !== 'dentro') return
            e.preventDefault()
            if (passi.current > 0) history.back()
            else vai('#/oggi')
          }}>
          <Icona nome="dentro" />
          {inbox > 0 && <span className="badge">{inbox}</span>}
        </a>
      </header>

      {/* Nuovo "giro" = la schermata si rimonta e rilegge i dati (Aggiungi no: perderesti il testo). */}
      <main key={primo === 'aggiungi' || primo === 'visita' ? primo : giro}>{schermata}</main>

      <nav className="tasti">
        <a href="#/oggi" className={tasto === 'oggi' ? 'attivo' : ''} onClick={inCima}>
          <Icona nome="oggi" /><span>Oggi</span>
        </a>
        <a href="#/aggiungi" className={'aggiungi' + (tasto === 'aggiungi' ? ' attivo' : '')} aria-label="Aggiungi">
          <span className="alone" aria-hidden="true" />
          <span className="anello" aria-hidden="true" />
          <span className="cuore"><Icona nome="piu" size={28} /></span>
        </a>
        <a href="#/chiedi" className={tasto === 'chiedi' ? 'attivo' : ''}>
          <Icona nome="cerca" /><span>Chiedi</span>
        </a>
      </nav>

      {avviso && (
        <div className={'avviso' + (avviso.azione ? ' con-azione' : '')} role="status">
          {avviso.testo}
          {avviso.azione && (
            <button type="button" onClick={() => { clearTimeout(timer.current); setAvviso(null); avviso.azione.fai() }}>
              {avviso.azione.etichetta}
            </button>
          )}
        </div>
      )}
    </AppCtx.Provider>
  )
}
