import { useEffect, useRef, useState } from 'react'
import { sb, areaDa, nomePersona, quando, CAMPI_PERSONA, etichettePersona } from './supabase'
import { useApp, chk, chiama, messaggioErrore, Icona, EtichettePersona, tenutoQui, tieniQui, useDettatura } from './componenti'
import { iniziali, battesimo } from './Aziende'

const pulisci = (s) => s.replace(/[,()%*\\.:]/g, '')
const STATI = { offerta: 'offerta', active: 'in corso', completed: 'finito', persa: 'persa' }
const TIPI = { nota: 'Nota', mail: 'Mail', persona: 'Persona', whatsapp: 'WhatsApp' }
// Parole delle domande che non sono nomi.
const VUOTE = new Set(['cosa', 'che', 'chi', 'come', 'quando', 'dove', 'perché', 'per', 'con', 'sui', 'sul', 'sulla', 'della',
  'del', 'dei', 'delle', 'mi', 'aveva', 'avevo', 'detto', 'ha', 'hanno', 'una', 'uno', 'gli', 'le', 'il', 'lo', 'quale', 'quanto'])

// Le parole trovate arrivano tra « »: qui diventano evidenziate.
function Evidenzia({ testo }) {
  return (testo || '').split(/(«[^»]*»)/).map((p, i) => (p.startsWith('«') && p.endsWith('»')
    ? <mark key={i}>{p.slice(1, -1)}</mark> : p))
}

// Tornando da una scheda ritrovi domanda e risultati; toccando Chiedi riparti da zero.
const tieniRicerca = (domanda, risultati) => tieniQui('chiedi', { domanda, risultati })

// Chiedi (fase 4, gratis): clienti e cantieri mentre scrivi; con Invio cerca per parole simili ovunque.
export default function Chiedi() {
  const { area } = useApp()
  const [tenuta] = useState(() => tenutoQui('chiedi'))
  const [domanda, setDomandaStato] = useState(tenuta?.domanda || '')
  const [risultati, setRisultati] = useState(tenuta?.risultati || null)
  const setDomanda = (d) => { setDomandaStato(d); tieniRicerca(d, risultati) }
  const [msg, setMsg] = useState('')
  const [lavoro, setLavoro] = useState(false)
  const ricerca = useRef(0)

  // I clienti sono pochi: si leggono una volta e si filtrano mentre scrivi.
  const [aziende, setAziende] = useState([])
  const [cantieri, setCantieri] = useState([])
  useEffect(() => {
    sb.from('aziende').select('id,nome,area,ragione_sociale,email,contatti,gruppo:gruppo_id(nome)')
      .is('eliminata_il', null).is('unito_in', null).order('nome')
      .then(({ data }) => setAziende(data || []))
    sb.from('cantieri').select('id,nome,stato,azienda_id,aziende(nome)').is('eliminata_il', null).order('nome', { ascending: false })
      .then(({ data }) => setCantieri(data || []))
  }, [])
  const testo = domanda.trim().toLowerCase()
  // Cantieri G&C: per numero d'offerta (O0214) o nome del cliente.
  const trovatiCantieri = testo.length < 2 || area === 'C' || area === 'P' ? [] : cantieri
    .filter((c) => c.azienda_id && [c.nome, c.aziende?.nome].some((s) => s && s.toLowerCase().includes(testo)))
    .slice(0, 6)
  const clienti = testo.length < 2 ? [] : aziende
    .filter((a) => area === 'T' || a.area === area)
    .filter((a) => [a.nome, a.ragione_sociale, ...(a.email || []), ...(a.contatti || []).map((c) => c.nome)]
      .some((s) => s && s.toLowerCase().includes(testo)))
    // Prima chi ha il nome che comincia così.
    .sort((x, y) => y.nome.toLowerCase().startsWith(testo) - x.nome.toLowerCase().startsWith(testo))
    .slice(0, 6)

  // Cerca in note, mail, schede persona e WhatsApp (funzione "cerca" del database: italiano, parole simili).
  async function cerca(e) {
    e.preventDefault()
    const parole = domanda.trim().split(/\s+/).map(pulisci).filter((p) => p.length > 2 && !VUOTE.has(p.toLowerCase()))
    if (!domanda.trim()) return
    setLavoro(true)
    setMsg('')
    try {
      // Persone per nome: tutte le parole della domanda che somigliano a un nome.
      const qp = parole.length
        ? sb.from('persone').select(CAMPI_PERSONA).is('eliminata_il', null).order('nome').limit(30)
          .or(parole.flatMap((p) => [`nome.ilike.${p}%`, `cognome.ilike.${p}%`]).join(','))
        : Promise.resolve({ data: [] })
      // Per significato (13.10.2026): le cose che parlano della stessa cosa anche con altre parole. Se non risponde, pazienza.
      // Arriva dopo (14.10.2026): i risultati per parole si vedono subito, questi si aggiungono sotto quando ci sono.
      const qs = chiama('significato', { azione: 'cerca', q: domanda.trim(), area: area === 'T' ? null : area, quanti: 15 })
        .then((r) => r?.risultati || []).catch(() => [])
      const [trovati, persone] = await Promise.all([
        sb.rpc('cerca', { q: domanda.trim(), area_scelta: area === 'T' ? null : area, quanti: 40 }),
        qp,
      ])
      let pers = chk(persone)
      // Prima chi ha più parole della domanda nel nome.
      const conta = (p) => parole.filter((w) => nomePersona(p).toLowerCase().split(/\s+/).some((x) => x.startsWith(w.toLowerCase()))).length
      if (area !== 'T') pers = pers.filter((p) => etichettePersona(p).some((x) => x.area.codice === area))
      pers = pers.map((p) => ({ ...p, n: conta(p) })).sort((a, b) => b.n - a.n).filter((p, _, t) => p.n === t[0].n).slice(0, 6)
      // Le mail citate più volte nella stessa conversazione: una sola.
      const visti = new Set()
      const cose = chk(trovati).filter((r) => {
        const k = r.tipo + r.titolo + r.estratto
        if (visti.has(k)) return false
        visti.add(k)
        return true
      })
      const mia = ++ricerca.current
      setRisultati({ cose, persone: pers, significato: null })
      setLavoro(false)
      // Solo quelle che la ricerca per parole non ha già trovato.
      const gia = new Set(cose.map((r) => r.tipo + r.id))
      const significato = (await qs).filter((r) => !gia.has(r.tipo + r.id)).slice(0, 10)
      if (mia !== ricerca.current) return // nel frattempo hai cercato altro
      setRisultati({ cose, persone: pers, significato })
      tieniRicerca(domanda, { cose, persone: pers, significato })
    } catch (e) {
      setMsg(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  // Microfono (14.10.2026): detti la domanda, poi cerco da solo quando finisci.
  const formRif = useRef(null)
  const dettatura = useDettatura((t) => setDomanda((domanda.trim() ? domanda.trim() + ' ' : '') + t))
  const eraAttiva = useRef(false)
  useEffect(() => {
    if (eraAttiva.current && !dettatura.attiva && domanda.trim()) formRif.current?.requestSubmit()
    eraAttiva.current = dettatura.attiva
  }, [dettatura.attiva]) // eslint-disable-line react-hooks/exhaustive-deps

  const vuoto = risultati && risultati.significato !== null && !risultati.cose.length && !risultati.persone.length && !risultati.significato?.length
    && !clienti.length && !trovatiCantieri.length

  return (
    <div className="schermata">
      <form className="cerca" onSubmit={cerca} ref={formRif}>
        <input type="search" value={domanda} onChange={(e) => setDomanda(e.target.value)}
          placeholder={dettatura.attiva ? 'Ti ascolto…' : 'Cerca clienti, cantieri, note e persone'} enterKeyHint="search" autoFocus={!tenuta?.domanda} />
        {dettatura.supportata && (
          <button type="button" className={'tasto-mic' + (dettatura.attiva ? ' attivo' : '')}
            onClick={dettatura.attiva ? dettatura.ferma : dettatura.avvia} aria-label={dettatura.attiva ? 'Ferma la dettatura' : 'Detta la domanda'}>
            <Icona nome="mic" />
          </button>
        )}
        <button type="submit" className="tasto-pieno" disabled={lavoro} aria-label="Cerca">
          <Icona nome="cerca" />
        </button>
      </form>
      <p className="nota-piccola">
        Scrivi come parli («cosa mi aveva detto Emiliana sui campioni»): cerco in note, mail, persone e WhatsApp{area !== 'T' ? ` di ${areaDa(area).nome}` : ''}, anche con parole simili e per significato.
      </p>

      {clienti.length > 0 && (
        <>
          <h2>Clienti</h2>
          <div className="elenco">
            {clienti.map((a) => {
              const persone = (a.contatti || []).map((c) => battesimo(c.nome)).filter(Boolean)
              return (
                <a key={a.id} className="riga riga-azienda" href={`#/azienda/${a.id}`}>
                  <span className="iniziali" aria-hidden="true">{iniziali(a.nome)}</span>
                  <span className="riga-corpo">
                    <span className="riga-testo">{a.nome}</span>
                    <span className="riga-meta">
                      {a.gruppo ? `Filiale di ${a.gruppo.nome}` : persone.slice(0, 3).join(', ') + (persone.length > 3 ? '…' : '')}
                    </span>
                  </span>
                  <Icona nome="freccia" size={18} />
                </a>
              )
            })}
          </div>
        </>
      )}

      {trovatiCantieri.length > 0 && (
        <>
          <h2>Cantieri G&C</h2>
          <div className="elenco">
            {trovatiCantieri.map((c) => (
              <a key={c.id} className="riga" href={`#/azienda/${c.azienda_id}?cantiere=${c.id}`}>
                <span className="pallino" style={{ background: areaDa('G').colore }} />
                <span className="riga-corpo">
                  <span className="riga-testo">{c.nome}</span>
                  <span className="riga-meta">{[c.aziende?.nome, STATI[c.stato] || c.stato].filter(Boolean).join(' · ')}</span>
                </span>
                <Icona nome="freccia" size={18} />
              </a>
            ))}
          </div>
        </>
      )}

      {msg && <p className="msg errore">{msg}</p>}
      {vuoto && <p className="msg">Non ho trovato niente.</p>}

      {risultati?.persone.length > 0 && (
        <>
          <h2>Persone</h2>
          <div className="elenco">
            {risultati.persone.map((p) => (
              <a key={p.id} className="riga" href={`#/persona/${p.id}`}>
                <span className="pallini">
                  {etichettePersona(p).map((x) => (
                    <span key={x.area.codice} className="pallino" style={{ background: x.area.colore }} />
                  ))}
                </span>
                <span className="riga-corpo">
                  <span className="riga-testo">{nomePersona(p)}</span>
                  <span className="riga-meta"><EtichettePersona p={p} /></span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}

      {risultati?.cose.length > 0 && (
        <>
          <h2>Trovato</h2>
          <div className="elenco">
            {risultati.cose.map((r) => (
              <a key={r.tipo + r.id} className="riga riga-trovato" href={r.collegamento}>
                <span className="pallino" style={{ background: areaDa(r.area)?.colore || 'var(--grigio)' }} />
                <span className="riga-corpo">
                  <span className="riga-meta">{TIPI[r.tipo]} · {r.titolo}{r.data ? ` · ${quando(r.data)}` : ''}</span>
                  <span className="riga-testo"><Evidenzia testo={r.estratto} /></span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}

      {risultati && risultati.significato === null && <p className="nota-piccola">Cerco anche per significato…</p>}
      {risultati?.significato?.length > 0 && (
        <>
          <h2>Parlano della stessa cosa</h2>
          <p className="nota-piccola">Trovate per significato, anche se non hanno le tue parole.</p>
          <div className="elenco">
            {risultati.significato.map((r) => (
              <a key={r.tipo + r.id} className="riga riga-trovato" href={r.collegamento}>
                <span className="pallino" style={{ background: areaDa(r.area)?.colore || 'var(--grigio)' }} />
                <span className="riga-corpo">
                  <span className="riga-meta">{TIPI[r.tipo]} · {r.titolo}{r.data ? ` · ${quando(r.data)}` : ''}</span>
                  <span className="riga-testo">{r.estratto}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
