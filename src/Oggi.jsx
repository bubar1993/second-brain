import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb, areaDa, quando, giorniDaOggi, leggi, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, NotaRiga, Stato, Icona } from './componenti'
import Rete from './Rete'
import { visiteAperte } from './Visita'

const corto = (s, n = 16) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const numero = (n) => (n == null ? '…' : n.toLocaleString('de-CH'))

// Giorni da oggi al prossimo compleanno (0 = oggi).
function giorniAlCompleanno(iso) {
  const [, m, g] = iso.split('-').map(Number)
  const oggi = new Date()
  oggi.setHours(0, 0, 0, 0)
  let d = new Date(oggi.getFullYear(), m - 1, g)
  if (d < oggi) d = new Date(oggi.getFullYear() + 1, m - 1, g)
  return Math.round((d - oggi) / 86400000)
}

export default function Oggi({ inbox, bozze, domande }) {
  const { area, avvisa, vai } = useApp()
  const rete = useRef(null)
  const [fatti, setFatti] = useState(() => new Set())
  const [lampo, setLampo] = useState(null)
  const [avanti, setAvanti] = useState(false)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    let qp = sb.from('promemoria').select('id,testo,area,scade_il,urgente,nota_id,ricorrenza')
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
    const qc = sb.from('persone').select('id,nome,cognome,compleanno,persone_aree(area)')
      .not('compleanno', 'is', null).is('eliminata_il', null)
    // Appuntamenti: da ora a 7 giorni, più le proposte degli agenti da approvare.
    const da = new Date(); da.setHours(0, 0, 0, 0)
    const a7 = new Date(da.getTime() + 8 * 86400000)
    let qe = sb.from('eventi').select('id,titolo,inizio,fine,tutto_il_giorno,luogo,area,stato,motivo,errore,aziende(id,nome),persone(id,nome,cognome)')
      .in('stato', ['confermato', 'proposto', 'da_creare']).is('fatto_il', null).gte('inizio', da.toISOString()).lt('inizio', a7.toISOString())
      .order('inizio').limit(60)
    if (area !== 'T') qe = qe.or(`area.eq.${area},area.is.null`)
    const oggiIso = `${da.getFullYear()}-${String(da.getMonth() + 1).padStart(2, '0')}-${String(da.getDate()).padStart(2, '0')}`
    let qr = sb.from('riassunti_giorno').select('parte,momento,testo,creata_il').eq('giorno', oggiIso)
    if (area === 'P') qr = qr.eq('parte', 'privato')
    else if (area !== 'T') qr = qr.eq('parte', 'lavoro')
    const [promemoria, note, recenti, nati, ev, ria] = await Promise.all([qp, qn, qa, qc, qe, qr])
    const aziende = []
    for (const r of chk(recenti)) {
      if (r.aziende && !aziende.some((a) => a.id === r.aziende.id)) aziende.push(r.aziende)
      if (aziende.length === 6) break
    }
    // Compleanni nei prossimi 14 giorni (l'anno non conta).
    const compleanni = chk(nati).map((p) => ({ ...p, tra: giorniAlCompleanno(p.compleanno) }))
      .filter((p) => p.tra <= 14 && (area === 'T' || p.persone_aree.some((x) => x.area === area)))
      .sort((a, b) => a.tra - b.tra)
    // Il riassunto più recente di ogni parte (la sera sostituisce il mattino).
    const riassunti = ['lavoro', 'privato'].map((parte) => chk(ria).filter((r) => r.parte === parte)
      .sort((a, b) => (a.momento === 'sera' ? -1 : 1) - (b.momento === 'sera' ? -1 : 1))[0]).filter(Boolean)
    return { promemoria: chk(promemoria), note: chk(note), aziende, compleanni, eventi: chk(ev), riassunti }
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
      // Le scadenze di ogni anno (cassa malati, gomme…) tornano l'anno dopo.
      if (p.ricorrenza === 'annuale' && p.scade_il) {
        const prossimo = new Date(p.scade_il)
        prossimo.setFullYear(prossimo.getFullYear() + 1)
        chk(await sb.from('promemoria').insert({ testo: p.testo, area: p.area, scade_il: prossimo.toISOString(), ricorrenza: 'annuale', urgente: p.urgente }))
      }
      avvisa(p.ricorrenza === 'annuale' ? 'Fatto: torna l\'anno prossimo' : 'Fatto')
      setTimeout(ricarica, 450)
    } catch (e) {
      setFatti((s) => { const x = new Set(s); x.delete(p.id); return x })
      avvisa(messaggioErrore(e))
    }
  }

  const promemoria = (dati?.promemoria || []).filter((p) => !fatti.has(p.id))
  const gruppi = { ritardo: [], oggi: [], prossimi: [], avanti: [], senzaData: [] }
  for (const p of dati?.promemoria || []) {
    if (!p.scade_il) gruppi.senzaData.push(p)
    else if (new Date(p.scade_il) < new Date()) gruppi.ritardo.push(p)
    else if (giorniDaOggi(p.scade_il) === 0) gruppi.oggi.push(p)
    else if (giorniDaOggi(p.scade_il) <= 14) gruppi.prossimi.push(p)
    else gruppi.avanti.push(p)
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

        {dati?.riassunti.map((r) => (
          <section key={r.parte} className="riassunto-giorno">
            <h3>{r.momento === 'mattino' ? 'Il punto del mattino' : 'Il punto della sera'}{dati.riassunti.length > 1 ? ` · ${r.parte === 'lavoro' ? 'lavoro' : 'privato'}` : ''}</h3>
            <p>{r.testo}</p>
          </section>
        ))}

        {visiteAperte().map((v) => (
          <a key={v.id} className="scheda scheda-allarme" href={`#/visita/${v.id}`}>
            <span>Appunti non finiti{v.titolo ? `: ${v.titolo}` : ''}. Tocca per riprendere e salvarli.</span>
            <Icona nome="freccia" size={18} />
          </a>
        ))}

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

        {domande > 0 && (
          <a className="scheda scheda-domande" href="#/domande">
            <span><strong>{domande}</strong> {domande === 1 ? 'domanda degli agenti per te' : 'domande degli agenti per te'}</span>
            <Icona nome="freccia" size={18} />
          </a>
        )}

        {inbox > 0 && (
          <a className="scheda scheda-inbox" href="#/inbox">
            <span><strong>{inbox}</strong> {inbox === 1 ? 'cosa' : 'cose'} nell'Inbox da smistare</span>
            <Icona nome="freccia" size={18} />
          </a>
        )}

        {dati && <Appuntamenti eventi={dati.eventi} ricarica={ricarica} />}

        <h2>Promemoria</h2>
        <Stato carica={carica} errore={errore} vuoto={nessunPromemoria ? 'Niente in sospeso. Quando aggiungi "Ricordamelo", compare qui e nella rete.' : null}>
          {dati && (
            <>
              <Gruppo titolo="In ritardo" righe={gruppi.ritardo} fatto={fatto} fatti={fatti} lampo={lampo} ritardo />
              <Gruppo titolo="Oggi" righe={gruppi.oggi} fatto={fatto} fatti={fatti} lampo={lampo} />
              <Gruppo titolo="Prossimi giorni" righe={gruppi.prossimi} fatto={fatto} fatti={fatti} lampo={lampo} />
              <Gruppo titolo="Senza data" righe={gruppi.senzaData} fatto={fatto} fatti={fatti} lampo={lampo} />
              {gruppi.avanti.length > 0 && (
                <>
                  <button type="button" className="tasto-link" onClick={() => setAvanti(!avanti)} aria-expanded={avanti}>
                    {avanti ? 'Nascondi quelli più avanti' : `Più avanti: ${gruppi.avanti.length}`}
                  </button>
                  {avanti && <Gruppo titolo="Più avanti" righe={gruppi.avanti} fatto={fatto} fatti={fatti} lampo={lampo} />}
                </>
              )}
            </>
          )}
        </Stato>

        {dati?.compleanni.length > 0 && (
          <>
            <h2>Compleanni</h2>
            <div className="elenco">
              {dati.compleanni.map((p) => (
                <a key={p.id} className="riga" href={`#/persona/${p.id}`}>
                  <span className="pallino" style={{ background: areaDa(p.persone_aree[0]?.area)?.colore || 'var(--grigio)' }} />
                  <span className="riga-corpo">
                    <span className="riga-testo">{[p.nome, p.cognome].filter(Boolean).join(' ')}</span>
                    <span className="riga-meta">{p.tra === 0 ? 'Oggi!' : p.tra === 1 ? 'Domani' : `Tra ${p.tra} giorni`}</span>
                  </span>
                </a>
              ))}
            </div>
          </>
        )}

        <h2>Ultime note</h2>
        <Stato carica={carica} errore={errore} vuoto={dati && dati.note.length === 0 ? 'Ancora nessuna nota tua. Tocca + per la prima.' : null}>
          {dati && <div className="elenco">{dati.note.map((n) => <NotaRiga key={n.id} nota={n} />)}</div>}
        </Stato>
      </div>
    </div>
  )
}

// Appuntamenti di oggi e dei prossimi giorni (da Google Calendar) e proposte degli agenti.
// Toccando un appuntamento con un cliente si apre la sua scheda: il riassunto da guardare prima della visita.
function Appuntamenti({ eventi, ricarica }) {
  const { avvisa } = useApp()
  const [fatti, setFatti] = useState(() => new Set())
  const proposte = eventi.filter((e) => e.stato === 'proposto')
  const fissi = eventi.filter((e) => e.stato !== 'proposto')
  if (!eventi.length) return null

  // Spunta: l'appuntamento sparisce da Oggi (in Google Calendar resta com'è).
  async function fatto(e) {
    if (fatti.has(e.id)) return
    setFatti((s) => new Set(s).add(e.id))
    try {
      chk(await sb.from('eventi').update({ fatto_il: new Date().toISOString() }).eq('id', e.id))
      avvisa('Fatto')
      setTimeout(ricarica, 450)
    } catch (err) {
      setFatti((s) => { const x = new Set(s); x.delete(e.id); return x })
      avvisa(messaggioErrore(err))
    }
  }

  async function decidi(e, si) {
    try {
      chk(await sb.from('eventi').update({ stato: si ? 'da_creare' : 'scartato' }).eq('id', e.id))
      avvisa(si ? 'Lo metto nel calendario entro un\'ora' : 'Scartato')
      ricarica()
    } catch (err) {
      avvisa(messaggioErrore(err))
    }
  }
  const ora = (e) => (e.tutto_il_giorno ? 'tutto il giorno'
    : new Date(e.inizio).toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' }))
  const giorno = (e) => {
    const g = giorniDaOggi(e.inizio)
    return g === 0 ? 'Oggi' : g === 1 ? 'Domani' : new Date(e.inizio).toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'short' })
  }
  // Prima della visita: la scheda. Dopo: "cosa vuoi annotare?" (Aggiungi con la persona già collegata).
  const finito = (e) => new Date(e.fine || e.inizio) < new Date()
  // Senza ditta né persona collegate: si apre la pagina degli appunti (lì si sceglie la ditta).
  const link = (e) => (e.persone ? (finito(e) ? `#/aggiungi?persona=${e.persone.id}` : `#/persona/${e.persone.id}`)
    : e.aziende ? `#/azienda/${e.aziende.id}` : `#/visita/${e.id}`)
  const diOggi = (e) => giorniDaOggi(e.inizio) === 0

  return (
    <>
      {proposte.length > 0 && (
        <>
          <h2>Da mettere in calendario?</h2>
          <div className="elenco">
            {proposte.map((e) => (
              <div key={e.id} className="riga riga-proposta">
                <span className="pallino" style={{ background: areaDa(e.area)?.colore || 'var(--grigio)' }} />
                <span className="riga-corpo">
                  <span className="riga-testo">{e.titolo}</span>
                  <span className="riga-meta">{giorno(e)} {ora(e)}{e.motivo ? ` · ${e.motivo}` : ''}</span>
                </span>
                <span className="azioni-proposta">
                  <button type="button" className="tasto-piccolo" onClick={() => decidi(e, true)}>Sì</button>
                  <button type="button" className="tasto-link" onClick={() => decidi(e, false)}>No</button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {fissi.length > 0 && (
        <>
          <h2>Appuntamenti</h2>
          <div className="elenco">
            {fissi.map((e) => {
              const finito = fatti.has(e.id)
              return (
                <div key={e.id} className={'voce-promemoria' + (finito ? ' via' : '')}>
                  <div>
                    <div style={{ '--col': areaDa(e.area)?.colore || 'var(--grigio)' }}
                      className={'riga riga-promemoria' + (finito ? ' fatto' : '')}>
                      <button type="button" className="spunta" onClick={() => fatto(e)} aria-label={`Segna fatto: ${e.titolo}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      </button>
                      <a className="riga-corpo" href={link(e)}>
                        <span className="riga-testo">{e.titolo}</span>
                        <span className="riga-meta">
                          {giorno(e)} {ora(e)}{e.luogo ? ` · ${e.luogo}` : ''}
                          {(e.persone || e.aziende) && (new Date(e.fine || e.inizio) < new Date() ? ' · com\'è andata? Annota' : ' · scheda')}
                          {e.stato === 'da_creare' && (e.errore ? <span className="rosso"> · non creato: {e.errore}</span> : ' · in arrivo nel calendario')}
                        </span>
                      </a>
                      {diOggi(e) && e.area !== 'P' && (
                        <a className="tasto-piccolo tasto-appunti" href={`#/visita/${e.id}`} aria-label={`Prendi appunti: ${e.titolo}`}>Appunti</a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
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
