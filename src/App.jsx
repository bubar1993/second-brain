import { useCallback, useEffect, useRef, useState } from 'react'
import { sb, AREE, areaDa, leggi, scrivi } from './supabase'
import { AppCtx, Icona, useLargo } from './componenti'
import Accesso from './Accesso'
import Oggi from './Oggi'
import Aggiungi from './Aggiungi'
import Chiedi from './Chiedi'
import { Dentro, Inbox, ElencoNote, Cestino } from './Dentro'
import { Persone, Persona } from './Persone'
import Nota from './Nota'
import { Aziende, Azienda } from './Aziende'
import { Bozze, Bozza, Mail } from './Bozze'

export default function App({ condiviso }) {
  const [sessione, setSessione] = useState(undefined)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSessione(data.session))
    const { data } = sb.auth.onAuthStateChange((_evento, s) => setSessione(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (sessione === undefined) return <div className="avvio" />
  if (!sessione) return <Accesso />
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

  useEffect(() => {
    const cambia = () => { setRotta(leggiRotta()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', cambia)
    return () => window.removeEventListener('hashchange', cambia)
  }, [])

  const setArea = (a) => { setAreaStato(a); scrivi('area', a) }
  const avvisa = useCallback((testo) => {
    clearTimeout(timer.current)
    setAvviso(testo)
    timer.current = setTimeout(() => setAvviso(null), 2600)
  }, [])
  const vai = (percorso) => { location.hash = percorso }

  // Numero di cose nell'Inbox e di bozze da approvare, aggiornati a ogni cambio schermata.
  const [bozze, setBozze] = useState(0)
  useEffect(() => {
    sb.from('note').select('id', { count: 'exact', head: true })
      .is('area', null).is('eliminata_il', null)
      .then(({ count }) => setInbox(count || 0))
    sb.from('bozze').select('id', { count: 'exact', head: true }).eq('stato', 'proposta')
      .then(({ count }) => setBozze(count || 0))
  }, [rotta])

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
    case 'aggiungi': schermata = <Aggiungi key={rotta.query.toString()} usaCondiviso={usaCondiviso} personaId={rotta.query.get('persona')} />; break
    case 'chiedi': schermata = <Chiedi />; break
    case 'dentro': schermata = <Dentro inbox={inbox} />; break
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
    default: schermata = <Oggi inbox={inbox} bozze={bozze} />
  }
  const tasto = ['oggi', 'aggiungi', 'chiedi'].includes(primo) ? primo : primo ? null : 'oggi'
  const sezioneLato = primo === 'azienda' ? 'aziende' : primo === 'persona' ? 'persone' : primo === 'bozza' ? 'bozze' : primo || 'oggi'

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
        {[['oggi', 'Oggi'], ['chiedi', 'Chiedi'], null, ['aziende', 'Aziende'], ['bozze', 'Bozze G&C'], ['persone', 'Persone'],
          ['inbox', 'Inbox'], ['note', 'Tutte le note'], ['cestino', 'Cestino']].map((v, i) => v ? (
          <a key={v[0]} href={`#/${v[0]}`} className={'lato-voce' + (sezioneLato === v[0] ? ' attivo' : '')}>
            <Icona nome={v[0] === 'chiedi' ? 'cerca' : v[0]} size={20} /><span>{v[1]}</span>
            {v[0] === 'inbox' && inbox > 0 && <span className="lato-badge">{inbox}</span>}
            {v[0] === 'bozze' && bozze > 0 && <span className="lato-badge">{bozze}</span>}
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
        <a href="#/dentro" className={'tasto-dentro' + (primo === 'dentro' ? ' attivo' : '')} aria-label="Dentro">
          <Icona nome="dentro" />
          {inbox > 0 && <span className="badge">{inbox}</span>}
        </a>
      </header>

      <main>{schermata}</main>

      <nav className="tasti">
        <a href="#/oggi" className={tasto === 'oggi' ? 'attivo' : ''}>
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

      {avviso && <div className="avviso" role="status">{avviso}</div>}
    </AppCtx.Provider>
  )
}
