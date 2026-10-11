import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb, areaDa, quando, giorniDaOggi, leggi, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, NotaRiga, Stato, Icona } from './componenti'
import Rete from './Rete'

const corto = (s, n = 16) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const numero = (n) => (n == null ? '…' : n.toLocaleString('de-CH'))

export default function Oggi({ inbox, bozze }) {
  const { area, avvisa, vai } = useApp()
  const rete = useRef(null)
  const [fatti, setFatti] = useState(() => new Set())
  const [lampo, setLampo] = useState(null)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    let qp = sb.from('promemoria').select('id,testo,area,scade_il,urgente,nota_id')
      .is('fatto_il', null).is('eliminata_il', null)
      .order('scade_il', { ascending: true, nullsFirst: false }).limit(50)
    // Le note dei clienti stanno nelle schede delle aziende: qui solo quelle scritte da Giovanni.
    let qn = sb.from('note').select('id,area,testo,fonte,creata_il,note_persone(persone(id,nome,cognome)),allegati(id)')
      .is('eliminata_il', null).not('area', 'is', null).is('azienda_id', null)
      .order('creata_il', { ascending: false }).limit(5)
    if (area !== 'T') {
      qp = qp.or(`area.eq.${area},area.is.null`)
      qn = qn.eq('area', area)
    }
    // Clienti che hanno scritto per ultimi (dalle note dell'agente).
    let qa = sb.from('note').select('data,aziende(id,nome,area)').not('azienda_id', 'is', null)
      .is('eliminata_il', null).is('scartata_il', null)
      .order('data', { ascending: false }).order('creata_il', { ascending: false }).limit(60)
    if (area === 'P') qa = Promise.resolve({ data: [] })
    else if (area !== 'T') qa = qa.eq('area', area)
    const [promemoria, note, recenti] = await Promise.all([qp, qn, qa])
    const aziende = []
    for (const r of chk(recenti)) {
      if (r.aziende && !aziende.some((a) => a.id === r.aziende.id)) aziende.push(r.aziende)
      if (aziende.length === 6) break
    }
    return { promemoria: chk(promemoria), note: chk(note), aziende }
  }, [area])

  // Quanto è grande la memoria: si legge una volta.
  const [totali, setTotali] = useState({ note: null, aziende: null })
  useEffect(() => {
    Promise.all([
      sb.from('note').select('id', { count: 'exact', head: true }).is('eliminata_il', null),
      sb.from('aziende').select('id', { count: 'exact', head: true }).is('eliminata_il', null).is('unito_in', null),
    ]).then(([n, a]) => setTotali({ note: n.count, aziende: a.count }))
  }, [])

  async function fatto(p) {
    if (fatti.has(p.id)) return
    setFatti((s) => new Set(s).add(p.id))
    rete.current?.assorbi(p.id)
    try {
      chk(await sb.from('promemoria').update({ fatto_il: new Date().toISOString() }).eq('id', p.id))
      avvisa('Fatto')
      setTimeout(ricarica, 450)
    } catch (e) {
      setFatti((s) => { const x = new Set(s); x.delete(p.id); return x })
      avvisa(messaggioErrore(e))
    }
  }

  const promemoria = (dati?.promemoria || []).filter((p) => !fatti.has(p.id))
  const gruppi = { ritardo: [], oggi: [], prossimi: [], senzaData: [] }
  for (const p of dati?.promemoria || []) {
    if (!p.scade_il) gruppi.senzaData.push(p)
    else if (new Date(p.scade_il) < new Date()) gruppi.ritardo.push(p)
    else if (giorniDaOggi(p.scade_il) === 0) gruppi.oggi.push(p)
    else gruppi.prossimi.push(p)
  }
  const nessunPromemoria = dati && dati.promemoria.length === 0
  const daFareOggi = promemoria.filter((p) => p.scade_il && giorniDaOggi(p.scade_il) <= 0).length

  // Neuroni: prima i promemoria aperti, poi le tue ultime note, poi i clienti che hanno scritto per ultimi.
  const chiaveNodi = dati ? [...promemoria, ...dati.note, ...dati.aziende].map((x) => x.id).join() : ''
  const nodi = useMemo(() => {
    if (!dati) return []
    const pr = promemoria.slice(0, 8).map((p) => ({ id: p.id, area: p.area, etichetta: corto(p.testo), tipo: 'promemoria' }))
    const no = dati.note.slice(0, Math.max(0, 4 - pr.length))
      .map((n) => ({ id: n.id, area: n.area, etichetta: corto(n.testo || 'Foto', 14), tipo: 'nota' }))
    const az = dati.aziende.slice(0, Math.max(0, 7 - pr.length - no.length))
      .map((a) => ({ id: a.id, area: a.area, etichetta: corto(a.nome, 16), tipo: 'azienda' }))
    return [...pr, ...no, ...az]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiaveNodi])

  const tocca = useCallback((n) => {
    if (n.tipo === 'nota') return vai(`/nota/${n.id}`)
    if (n.tipo === 'azienda') return vai(`/azienda/${n.id}`)
    setLampo({ id: n.id, k: Date.now() })
  }, [vai])

  const oggi = new Date()
  const giorno = oggi.toLocaleDateString('it-CH', { weekday: 'long' })

  return (
    <div className="schermata oggi">
      <section className="rete" aria-label="La rete di oggi: trascina per ruotarla, tocca un nodo">
        <Rete ref={rete} nodi={nodi} onTocca={tocca} />
        <div className="nucleo">
          <span className="giorno">{giorno.charAt(0).toUpperCase() + giorno.slice(1)}</span>
          <span className="data">{oggi.toLocaleDateString('it-CH', { day: 'numeric', month: 'long' })}</span>
        </div>
        <p className="piede">La tua memoria: <b>{numero(totali.note)}</b> note, <b>{numero(totali.aziende)}</b> aziende</p>
      </section>

      {/* Sul PC questa colonna sta a destra della rete. */}
      <div className="oggi-colonna">
        <h1 className="titolo-oggi">
          {!dati ? 'Oggi' : daFareOggi === 0 ? 'Niente di urgente oggi' : daFareOggi === 1 ? '1 cosa da fare oggi' : `${daFareOggi} cose da fare oggi`}
        </h1>

        <AttivaImpronta />
        <AvvisoBackup />
        <AvvisoCopia />
        <AvvisoLavoriGC />

        {bozze > 0 && (area === 'T' || area === 'G') && (
          <a className="scheda scheda-bozze" href="#/bozze">
            <span><strong>{bozze}</strong> {bozze === 1 ? 'bozza G&C da approvare' : 'bozze G&C da approvare'}</span>
            <Icona nome="freccia" size={18} />
          </a>
        )}

        {inbox > 0 && (
          <a className="scheda scheda-inbox" href="#/inbox">
            <span><strong>{inbox}</strong> {inbox === 1 ? 'cosa' : 'cose'} nell'Inbox da smistare</span>
            <Icona nome="freccia" size={18} />
          </a>
        )}

        <h2>Promemoria</h2>
        <Stato carica={carica} errore={errore} vuoto={nessunPromemoria ? 'Niente in sospeso. Quando aggiungi "Ricordamelo", compare qui e nella rete.' : null}>
          {dati && (
            <>
              <Gruppo titolo="In ritardo" righe={gruppi.ritardo} fatto={fatto} fatti={fatti} lampo={lampo} ritardo />
              <Gruppo titolo="Oggi" righe={gruppi.oggi} fatto={fatto} fatti={fatti} lampo={lampo} />
              <Gruppo titolo="Prossimi giorni" righe={gruppi.prossimi} fatto={fatto} fatti={fatti} lampo={lampo} />
              <Gruppo titolo="Senza data" righe={gruppi.senzaData} fatto={fatto} fatti={fatti} lampo={lampo} />
            </>
          )}
        </Stato>

        <h2>Ultime note</h2>
        <Stato carica={carica} errore={errore} vuoto={dati && dati.note.length === 0 ? 'Ancora nessuna nota tua. Tocca + per la prima.' : null}>
          {dati && <div className="elenco">{dati.note.map((n) => <NotaRiga key={n.id} nota={n} />)}</div>}
        </Stato>
      </div>
    </div>
  )
}

function Gruppo({ titolo, righe, fatto, fatti, lampo, ritardo }) {
  if (!righe.length) return null
  return (
    <>
      <h3 className={ritardo ? 'rosso' : ''}>{titolo}</h3>
      <div className="elenco">
        {righe.map((p) => {
          const a = areaDa(p.area)
          const finito = fatti.has(p.id)
          return (
            <div key={p.id} className={'voce-promemoria' + (finito ? ' via' : '')}>
              <div>
                <div key={lampo?.id === p.id ? lampo.k : 0} style={{ '--col': a?.colore || 'var(--grigio)' }}
                  className={'riga riga-promemoria' + (finito ? ' fatto' : '') + (lampo?.id === p.id ? ' lampo' : '')}>
                  <button type="button" className="spunta" onClick={() => fatto(p)} aria-label={`Segna fatto: ${p.testo}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  </button>
                  <a className="riga-corpo" href={p.nota_id ? `#/nota/${p.nota_id}` : undefined}>
                    <span className="riga-testo">{p.urgente && <strong className="rosso">! </strong>}{p.testo}</span>
                    <span className="riga-meta">
                      {a && <span className="etichetta" style={{ color: a.colore }}>{a.nome}</span>}
                      {p.scade_il && ` ${quando(p.scade_il, true)}`}
                    </span>
                  </a>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// Avviso se l'ultimo backup su Drive non è riuscito o è troppo vecchio (si fa ogni domenica).
function AvvisoBackup() {
  const [ultimo, setUltimo] = useState(null)

  useEffect(() => {
    sb.from('backup_registro').select('eseguito_il,ok').order('id', { ascending: false }).limit(1)
      .then(({ data }) => setUltimo(data?.[0] || null))
  }, [])

  if (!ultimo) return null
  const vecchio = giorniDaOggi(ultimo.eseguito_il) < -9
  if (ultimo.ok && !vecchio) return null
  return (
    <div className="scheda scheda-allarme">
      <p>
        {ultimo.ok
          ? `Il backup su Drive non parte da più di una settimana (ultimo: ${quando(ultimo.eseguito_il)}).`
          : `Il backup su Drive non è riuscito (${quando(ultimo.eseguito_il)}).`}
        {' '}Dillo a Claude.
      </p>
    </div>
  )
}

// Avviso se la copia automatica delle note da Ceramex (ogni 10 minuti) non va o è ferma da più di un'ora.
function AvvisoCopia() {
  const [ultima, setUltima] = useState(null)

  useEffect(() => {
    sb.from('copia_registro').select('iniziata_il,ok').order('id', { ascending: false }).limit(1)
      .then(({ data }) => setUltima(data?.[0] || null))
  }, [])

  if (!ultima) return null
  const ferma = Date.now() - new Date(ultima.iniziata_il).getTime() > 3600000
  if (ultima.ok && !ferma) return null
  return (
    <div className="scheda scheda-allarme">
      <p>
        {ultima.ok
          ? `Le note da Ceramex non arrivano da più di un'ora (ultima copia: ${quando(ultima.iniziata_il, true)}).`
          : `La copia delle note da Ceramex non è riuscita (${quando(ultima.iniziata_il, true)}).`}
        {' '}Dillo a Claude.
      </p>
    </div>
  )
}

// Avviso se la posta di info@ o la copia dal gestionale G&C non vanno (posta ogni 5 minuti, copia ogni ora).
const LAVORI_GC = [
  ['posta-gc', 'La posta di info@homeconcepts.ch', 30 * 60000],
  ['copia-gc', 'La copia di clienti e cantieri dal gestionale G&C', 3 * 3600000],
]
function AvvisoLavoriGC() {
  const [ultimi, setUltimi] = useState([])

  useEffect(() => {
    Promise.all(LAVORI_GC.map(([lavoro]) => sb.from('lavori_registro').select('lavoro,iniziata_il,ok,errore')
      .eq('lavoro', lavoro).order('id', { ascending: false }).limit(1)))
      .then((r) => setUltimi(r.map(({ data }) => data?.[0]).filter(Boolean)))
  }, [])

  const problemi = ultimi.map((u) => {
    const [, nome, massimo] = LAVORI_GC.find(([l]) => l === u.lavoro)
    if (u.errore?.includes('GC_MAIL_PASSWORD')) return `${nome} non è ancora collegata: manca la password della casella.`
    if (!u.ok) return `${nome} non è riuscita (${quando(u.iniziata_il, true)}).`
    if (Date.now() - new Date(u.iniziata_il).getTime() > massimo) return `${nome} è ferma dal ${quando(u.iniziata_il, true)}.`
    return null
  }).filter(Boolean)

  if (!problemi.length) return null
  return (
    <div className="scheda scheda-allarme">
      <p>{problemi.join(' ')} Dillo a Claude.</p>
    </div>
  )
}

// Invito ad attivare l'accesso con impronta/volto, finché non è attivo.
function AttivaImpronta() {
  const { avvisa } = useApp()
  const [mostra, setMostra] = useState(false)
  const [lavoro, setLavoro] = useState(false)

  useEffect(() => {
    if (!window.PublicKeyCredential || leggi('impronta-rimandata') === '1') return
    sb.auth.passkey.list().then(({ data, error }) => {
      if (error) return
      if (data?.length) scrivi('impronta-attiva', '1')
      else setMostra(true)
    })
  }, [])

  async function attiva() {
    setLavoro(true)
    const { error } = await sb.auth.registerPasskey()
    setLavoro(false)
    if (error) return avvisa('Impronta non attivata: ' + (error.message || 'riprova'))
    scrivi('impronta-attiva', '1')
    setMostra(false)
    avvisa('Fatto. Dalla prossima volta entri con impronta o volto.')
  }

  if (!mostra) return null
  return (
    <div className="scheda scheda-impronta">
      <p>Vuoi entrare con impronta o volto, senza codici?</p>
      <div className="azioni">
        <button type="button" className="tasto-pieno" onClick={attiva} disabled={lavoro}>Attiva</button>
        <button type="button" className="tasto-link" onClick={() => { scrivi('impronta-rimandata', '1'); setMostra(false) }}>
          Più tardi
        </button>
      </div>
    </div>
  )
}
