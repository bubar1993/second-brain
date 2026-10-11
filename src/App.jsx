import { useCallback, useEffect, useRef, useState } from 'react'
import { sb, AREE, areaDa, leggi, scrivi } from './supabase'
import { AppCtx, Icona } from './componenti'
import Accesso from './Accesso'
import Oggi from './Oggi'
import Aggiungi from './Aggiungi'
import Chiedi from './Chiedi'
import { Dentro, Inbox, ElencoNote, Cestino } from './Dentro'
import { Persone, Persona } from './Persone'
import Nota from './Nota'
import { Aziende, Azienda } from './Aziende'

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

  // Numero di cose nell'Inbox, aggiornato a ogni cambio schermata.
  useEffect(() => {
    sb.from('note').select('id', { count: 'exact', head: true })
      .is('area', null).is('eliminata_il', null)
      .then(({ count }) => setInbox(count || 0))
  }, [rotta])

  const [primo, secondo] = rotta.parti
  let schermata
  switch (primo) {
    case 'aggiungi': schermata = <Aggiungi key={rotta.query.toString()} usaCondiviso={usaCondiviso} personaId={rotta.query.get('persona')} />; break
    case 'chiedi': schermata = <Chiedi />; break
    case 'dentro': schermata = <Dentro inbox={inbox} />; break
    case 'inbox': schermata = <Inbox />; break
    case 'note': schermata = <ElencoNote />; break
    case 'cestino': schermata = <Cestino />; break
    case 'persone': schermata = <Persone />; break
    case 'persona': schermata = <Persona key={secondo} id={secondo} />; break
    case 'aziende': schermata = <Aziende />; break
    case 'azienda': schermata = <Azienda key={secondo} id={secondo} />; break
    case 'nota': schermata = <Nota key={secondo} id={secondo} />; break
    default: schermata = <Oggi inbox={inbox} />
  }
  const tasto = ['oggi', 'aggiungi', 'chiedi'].includes(primo) ? primo : primo ? null : 'oggi'

  return (
    <AppCtx.Provider value={{ area, setArea, avvisa, vai, utente }}>
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
