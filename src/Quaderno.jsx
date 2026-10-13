import { useEffect, useState } from 'react'
import { sb, areaDa, leggi, scrivi, nomePersona, CAMPI_PERSONA } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Icona, useLargo } from './componenti'
import { nomeSezione, useRisolvi } from './Aziende'
import Nota from './Nota'

// Quaderno Note (13.10.2026, bozza approvata da Giovanni): tutte le note per intero, come un blocco note.
// Tre quaderni: Ceramex (cliente → note per mandante e data), G&C (cliente → cantiere → note per data),
// Privato (capitoli per persona e per tema, li sceglie Giovanni: tabelle quaderno_capitoli e note_temi).
// Di solito si vedono solo le note di Giovanni (scritte, dettate, foto, condivise); il tasto "Anche quelle degli
// agenti" mostra anche quelle nate dalle mail e da WhatsApp. Sul PC: capitoli, note e nota aperta una accanto all'altra.
// Indirizzi: #/quaderno, #/quaderno/C, #/quaderno/C/<azienda>?m=<mandante>, #/quaderno/G/<azienda>?cantiere=<id|generale>,
// #/quaderno/P/persona/<id>, #/quaderno/P/tema/<id>, #/quaderno/<area>/senza; sul PC ?nota=<id> apre la nota a destra.

const MIE = ['scritta', 'voce', 'foto', 'condivisa']
const mia = (n) => MIE.includes(n.fonte)
const QUADERNI = [
  { codice: 'C', sotto: 'Clienti, poi le note per mandante' },
  { codice: 'G', sotto: 'Clienti, cantieri, poi le note' },
  { codice: 'P', sotto: 'Persone e temi, li scegli tu' },
]
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const CAMPI_NOTA = 'id,area,azienda_id,cantiere_id,testo,mandante,sezione,data,contatto,fonte,risolto_il,creata_il,note_persone(persona_id)'
const FONTI = { voce: 'dettata', foto: 'foto', condivisa: 'condivisa', mail: 'dalla mail', whatsapp: 'da WhatsApp' }

// Legge tutte le righe anche oltre il limite di 1000 per richiesta.
async function tutte(crea) {
  const righe = []
  for (let da = 0; ; da += 1000) {
    const pezzo = chk(await crea().range(da, da + 999))
    righe.push(...pezzo)
    if (pezzo.length < 1000) return righe
  }
}

const giornoDi = (n) => n.data || (n.creata_il || '').slice(0, 10)
function nomeGiorno(g) {
  if (!g) return 'Senza data'
  const oggi = new Date()
  const iso = (d) => d.toLocaleDateString('sv-SE')
  if (g === iso(oggi)) return 'Oggi'
  if (g === iso(new Date(oggi.getTime() - 86400e3))) return 'Ieri'
  const [a, m, d] = g.split('-')
  return `${Number(d)} ${MESI[Number(m) - 1]}${a === String(oggi.getFullYear()) ? '' : ` ${a}`}`
}
function perGiorno(note) {
  const gruppi = []
  for (const n of note) {
    const g = giornoDi(n)
    const ultimo = gruppi[gruppi.length - 1]
    if (ultimo?.[0] === g) ultimo[1].push(n)
    else gruppi.push([g, [n]])
  }
  return gruppi
}
const ordinaNote = (note) => [...note].sort((a, b) => giornoDi(b).localeCompare(giornoDi(a)) || (b.creata_il || '').localeCompare(a.creata_il || ''))

// "Anche quelle degli agenti": scelta ricordata sul telefono.
function useAgenti() {
  const [si, setSi] = useState(() => leggi('quaderno-agenti') === '1')
  return [si, (v) => { setSi(v); scrivi('quaderno-agenti', v ? '1' : '') }]
}

// Link a una nota: sul PC si apre nella colonna a destra, sul telefono a tutta pagina.
function useLinkNota() {
  const largo = useLargo()
  return (id) => {
    if (!largo) return `#/nota/${id}`
    const [percorso, query = ''] = location.hash.replace(/^#/, '').split('?')
    const q = new URLSearchParams(query)
    q.set('nota', id)
    return `#${percorso}?${q}`
  }
}

export function Quaderno({ parti, query }) {
  const largo = useLargo()
  const [area, a, b] = parti
  const notaAperta = query.get('nota')
  const contenuto = !area ? <Copertina />
    : area === 'P' && (a === 'persona' || a === 'tema') ? <CapitoloPrivato key={b} tipo={a} id={b} />
      : a === 'senza' ? <SenzaCapitolo key={area} area={area} />
        : a ? <Cliente key={a} area={area} id={a} query={query} />
          : <Capitoli key={area} area={area} />

  if (!largo || !area) return contenuto
  // Sul PC: a sinistra i capitoli del quaderno, al centro il capitolo, a destra la nota aperta.
  return (
    <div className="quaderno-pc">
      <div className="quaderno-pc-col">{a ? <Capitoli key={area} area={area} compatto /> : contenuto}</div>
      <div className="quaderno-pc-col">{a ? contenuto : <p className="msg vuoto-diviso">Scegli un capitolo a sinistra.</p>}</div>
      <div className="quaderno-pc-col quaderno-pc-nota">
        {notaAperta ? <Nota key={notaAperta} id={notaAperta} /> : <p className="msg vuoto-diviso">Tocca una nota per aprirla qui.</p>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Copertina: i tre quaderni, la ricerca, le ultime note                */
/* ------------------------------------------------------------------ */
function Copertina() {
  const [cerca, setCerca] = useState('')
  const linkNota = useLinkNota()
  const { dati, errore, carica } = useCarica(async () => {
    const [ultime, aperti] = await Promise.all([
      sb.from('note').select('id,area,testo,data,creata_il,aziende(nome),cantieri(nome),mandante')
        .in('fonte', MIE).in('area', ['C', 'G', 'P']).is('eliminata_il', null).order('creata_il', { ascending: false }).limit(5).then(chk),
      sb.from('note').select('area').eq('sezione', 'problemi').is('risolto_il', null).is('eliminata_il', null).is('scartata_il', null)
        .in('area', ['C', 'G']).then(chk),
    ])
    const problemi = { C: 0, G: 0 }
    aperti.forEach((n) => { problemi[n.area]++ })
    return { ultime, problemi }
  }, [])

  return (
    <div className="schermata quaderno">
      <h1 className="titolo-quaderno">Note</h1>
      <p className="nota-piccola">Tutte le note per intero, in tre quaderni.</p>
      <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca nelle note: cliente, cantiere, parola…" />
      {cerca.trim().length >= 3 ? <Trovate q={cerca} /> : (
        <>
          <nav className="quaderni" aria-label="Quaderni">
            {QUADERNI.map((q) => {
              const a = areaDa(q.codice)
              const aperti = dati?.problemi[q.codice] || 0
              return (
                <a key={q.codice} href={`#/quaderno/${q.codice}`} className="quaderno-voce" style={{ '--col': a.colore }}>
                  <span className="dorso" aria-hidden="true" />
                  <span className="quaderno-testo">
                    <span className="quaderno-nome">{a.nome}</span>
                    <span className="nota-piccola">{q.sotto}</span>
                  </span>
                  {aperti > 0 ? <span className="rosso quaderno-aperti">{aperti} {aperti === 1 ? 'aperto' : 'aperti'}</span> : <Icona nome="freccia" size={18} />}
                </a>
              )
            })}
          </nav>
          <Stato carica={carica} errore={errore}>
            {dati?.ultime.length > 0 && (
              <section className="blocco">
                <h3>Ultime che hai scritto</h3>
                <div className="elenco">
                  {dati.ultime.map((n) => (
                    <a key={n.id} href={linkNota(n.id)} className="riga ultima-nota">
                      <span className="riga-corpo">
                        <span className="riga-meta" style={{ color: areaDa(n.area)?.colore }}>
                          {[n.aziende?.nome, n.cantieri?.nome, n.mandante, nomeGiorno(giornoDi(n))].filter(Boolean).join(' · ')}
                        </span>
                        <span className="riga-testo">{n.testo}</span>
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </Stato>
        </>
      )}
    </div>
  )
}

// Ricerca nel testo delle note (dell'area scelta in alto), le più recenti prima.
function Trovate({ q, area: soloArea }) {
  const { area } = useApp()
  const linkNota = useLinkNota()
  const [righe, setRighe] = useState(null)
  useEffect(() => {
    const t = setTimeout(async () => {
      const parole = q.trim().replace(/[%_,()]/g, ' ').split(/\s+/).filter((p) => p.length > 1).slice(0, 4)
      let qr = sb.from('note').select('id,area,testo,data,creata_il,fonte,aziende(nome),cantieri(nome),mandante')
        .is('eliminata_il', null).order('creata_il', { ascending: false }).limit(40)
      const aree = soloArea ? [soloArea] : area === 'T' ? ['C', 'G', 'P'] : [area]
      qr = qr.in('area', aree)
      for (const p of parole) qr = qr.ilike('testo', `%${p}%`)
      const { data } = await qr
      setRighe(data || [])
    }, 300)
    return () => clearTimeout(t)
  }, [q, area, soloArea])
  if (!righe) return <p className="msg">Cerco…</p>
  if (!righe.length) return <p className="msg">Nessuna nota con queste parole.</p>
  return (
    <div className="elenco">
      {righe.map((n) => (
        <a key={n.id} href={linkNota(n.id)} className="riga ultima-nota">
          <span className="riga-corpo">
            <span className="riga-meta" style={{ color: areaDa(n.area)?.colore }}>
              {[n.aziende?.nome, n.cantieri?.nome, n.mandante, nomeGiorno(giornoDi(n)), !mia(n) && 'agente'].filter(Boolean).join(' · ')}
            </span>
            <span className="riga-testo">{n.testo}</span>
          </span>
        </a>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Capitoli di un quaderno                                             */
/* ------------------------------------------------------------------ */
function Capitoli({ area, compatto }) {
  if (area === 'P') return <CapitoliPrivato compatto={compatto} />
  return <CapitoliClienti area={area} compatto={compatto} />
}

function TestaQuaderno({ area, titolo, indietro = '#/quaderno', destra }) {
  const a = areaDa(area)
  return (
    <>
      <div className="testa-quaderno">
        <a href={indietro} className="tasto-link torna"><Icona nome="indietro" size={18} />{indietro === '#/quaderno' ? 'Note' : a.nome}</a>
        {destra}
      </div>
      <h1 className="titolo-quaderno" style={{ '--col': a.colore }}><span className="pallino" aria-hidden="true" />{titolo || a.nome}</h1>
    </>
  )
}

function CapitoliClienti({ area, compatto }) {
  const [cerca, setCerca] = useState('')
  const [agenti] = useAgenti()
  const { dati, errore, carica } = useCarica(async () => {
    const [aziende, note] = await Promise.all([
      tutte(() => sb.from('aziende').select('id,nome,gruppo_id').eq('area', area).is('eliminata_il', null).is('unito_in', null).order('nome')),
      tutte(() => sb.from('note').select('azienda_id,fonte,data,creata_il,sezione,risolto_il,mandante').eq('area', area)
        .is('eliminata_il', null).is('scartata_il', null)),
    ])
    const info = Object.fromEntries(aziende.map((x) => [x.id, { ...x, mie: 0, tutte: 0, ultima: '', aperti: {}, filiali: [] }]))
    let senza = 0
    for (const n of note) {
      const i = info[n.azienda_id]
      if (!i) { if (!n.azienda_id && (agenti || mia(n))) senza++; continue }
      i.tutte++
      if (mia(n)) i.mie++
      const g = giornoDi(n)
      if (g > i.ultima) i.ultima = g
      if (n.sezione === 'problemi' && !n.risolto_il) i.aperti[n.mandante || 'Altro'] = (i.aperti[n.mandante || 'Altro'] || 0) + 1
    }
    // Le filiali stanno sotto il loro gruppo (come nel gestionale Ceramex).
    const capi = []
    for (const x of Object.values(info)) {
      if (x.gruppo_id && info[x.gruppo_id]) info[x.gruppo_id].filiali.push(x)
      else capi.push(x)
    }
    for (const c of capi) {
      c.filiali.sort((p, q) => q.ultima.localeCompare(p.ultima))
      c.ultimaGruppo = [c.ultima, ...c.filiali.map((f) => f.ultima)].sort().pop() || ''
    }
    capi.sort((p, q) => q.ultimaGruppo.localeCompare(p.ultimaGruppo) || p.nome.localeCompare(q.nome, 'it'))
    return { capi, senza, info }
  }, [area, agenti])

  const q = cerca.trim().toLowerCase()
  const visibili = (dati?.capi || []).filter((c) => !q || [c.nome, ...c.filiali.map((f) => f.nome)].some((n) => n.toLowerCase().includes(q)))
  const aperti = Object.values(dati?.info || {}).flatMap((x) => Object.entries(x.aperti).map(([m, n]) => ({ x, m, n })))

  const riga = (c, filiale) => {
    const quante = agenti ? c.tutte : c.mie
    const nAperti = Object.values(c.aperti).reduce((s, n) => s + n, 0)
    return (
      <a key={c.id} href={`#/quaderno/${area}/${c.id}`} className={'riga capitolo' + (filiale ? ' filiale' : '')}>
        <span className="riga-corpo">
          <span className="riga-testo">{c.nome}</span>
          <span className="riga-meta">
            {!filiale && c.filiali.length > 0 && `Gruppo · ${c.filiali.length} ${c.filiali.length === 1 ? 'filiale' : 'filiali'} · `}
            {c.ultima ? `ultima nota ${nomeGiorno(c.ultima).toLowerCase()}` : 'ancora nessuna nota'}
            {!agenti && c.tutte > c.mie && ` · ${c.tutte - c.mie} degli agenti`}
          </span>
        </span>
        {nAperti > 0 ? <span className="rosso conto-capitolo">{nAperti} {nAperti === 1 ? 'aperto' : 'aperti'}</span>
          : <span className="conto-capitolo">{quante || ''}</span>}
      </a>
    )
  }

  return (
    <div className="schermata quaderno">
      <TestaQuaderno area={area} />
      <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca un cliente o una parola" />
      {cerca.trim().length >= 3 && !visibili.length ? <Trovate q={cerca} area={area} /> : (
        <Stato carica={carica} errore={errore}>
          {dati && (
            <>
              {!q && aperti.length > 0 && (
                <section className="blocco">
                  <h3 className="rosso">Problemi aperti</h3>
                  <div className="elenco">
                    {aperti.map(({ x, m, n }) => (
                      <a key={x.id + m} href={`#/quaderno/${area}/${x.gruppo_id && dati.info[x.gruppo_id] ? x.gruppo_id : x.id}?m=${encodeURIComponent(m)}`} className="riga capitolo aperto">
                        <span className="riga-corpo"><span className="riga-testo">{x.nome} · {m}</span></span>
                        <span className="rosso conto-capitolo">{n} {n === 1 ? 'aperto' : 'aperti'}</span>
                      </a>
                    ))}
                  </div>
                </section>
              )}
              <section className="blocco">
                <h3>Clienti, dal più recente</h3>
                <div className="elenco">
                  {visibili.map((c) => [riga(c), ...c.filiali.filter((f) => f.tutte).map((f) => riga(f, true))])}
                  {!q && (
                    <a href={`#/quaderno/${area}/senza`} className="riga capitolo senza">
                      <span className="riga-corpo"><span className="riga-testo">Senza cliente</span><span className="riga-meta">note di lavoro non ancora attribuite</span></span>
                      <span className="conto-capitolo">{dati.senza || ''}</span>
                    </a>
                  )}
                </div>
              </section>
              {!compatto && <p className="nota-piccola">Un capitolo per cliente; le filiali stanno sotto il loro gruppo. Le note scritte da dentro un cliente vanno già lì.</p>}
            </>
          )}
        </Stato>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Un cliente: Ceramex per mandante, G&C per cantiere                   */
/* ------------------------------------------------------------------ */
function Cliente({ area, id, query }) {
  const [agenti, setAgenti] = useAgenti()
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [a, filiali] = await Promise.all([
      sb.from('aziende').select('id,nome,area,unito_in,gruppo:gruppo_id(id,nome)').eq('id', id).single().then(chk),
      sb.from('aziende').select('id,nome').eq('gruppo_id', id).is('eliminata_il', null).then(chk),
    ])
    const ids = [id, ...filiali.map((f) => f.id)]
    const [note, cantieri] = await Promise.all([
      tutte(() => sb.from('note').select(CAMPI_NOTA).in('azienda_id', ids).is('eliminata_il', null).is('scartata_il', null)),
      area === 'G' ? sb.from('cantieri').select('id,nome,stato').in('azienda_id', ids).is('eliminata_il', null).then(chk) : [],
    ])
    return { a, filiali, note: ordinaNote(note), cantieri }
  }, [id])
  const risolvi = useRisolvi(ricarica)

  // Una scheda unita a un'altra porta a quella giusta.
  const unita = dati?.a.unito_in
  useEffect(() => { if (unita) location.replace(`#/quaderno/${area}/${unita}`) }, [unita, area])

  if (!dati) return <div className="schermata quaderno"><TestaQuaderno area={area} titolo=" " indietro={`#/quaderno/${area}`} /><Stato carica={carica} errore={errore} /></div>

  const { a, filiali, note, cantieri } = dati
  const nomeSede = Object.fromEntries([[a.id, a.nome], ...filiali.map((f) => [f.id, f.nome])])
  const visibili = note.filter((n) => agenti || mia(n))

  // Ceramex: un capitolo per mandante. G&C: un capitolo per cantiere (più "Generale").
  let schede, scelta, filtro, nuova
  if (area === 'G') {
    const conNote = cantieri.map((c) => ({ ...c, n: visibili.filter((n) => n.cantiere_id === c.id).length, tutte: note.filter((n) => n.cantiere_id === c.id).length }))
      .filter((c) => c.tutte).sort((x, y) => (giornoDi(note.find((n) => n.cantiere_id === y.id)) || '').localeCompare(giornoDi(note.find((n) => n.cantiere_id === x.id)) || ''))
    const generale = { id: 'generale', nome: 'Generale, senza cantiere', n: visibili.filter((n) => !n.cantiere_id).length, tutte: note.filter((n) => !n.cantiere_id).length }
    schede = [...conNote, ...(generale.tutte || !conNote.length ? [generale] : [])]
    scelta = schede.find((s) => s.id === query.get('cantiere')) || schede[0]
    filtro = (n) => (scelta?.id === 'generale' ? !n.cantiere_id : n.cantiere_id === scelta?.id)
    nuova = `#/aggiungi?azienda=${id}&area=G${scelta && scelta.id !== 'generale' ? `&cantiere=${scelta.id}` : ''}`
  } else {
    const conta = {}
    for (const n of note) {
      const m = n.mandante || 'Altro'
      conta[m] ||= { id: m, nome: m, n: 0, tutte: 0, aperti: 0 }
      conta[m].tutte++
      if (agenti || mia(n)) conta[m].n++
      if (n.sezione === 'problemi' && !n.risolto_il) conta[m].aperti++
    }
    schede = Object.values(conta).sort((x, y) => y.tutte - x.tutte)
    scelta = schede.find((s) => s.id === query.get('m')) || schede.find((s) => s.aperti) || schede[0]
    filtro = (n) => (n.mandante || 'Altro') === scelta?.id
    nuova = `#/aggiungi?azienda=${id}&area=${area}`
  }
  const dellaScheda = note.filter(filtro)
  const mostrate = dellaScheda.filter((n) => agenti || mia(n))
  const nascoste = dellaScheda.length - mostrate.length
  const cambia = (k, v) => {
    const q = new URLSearchParams(query)
    q.set(k, v)
    q.delete('nota')
    location.replace(`#/quaderno/${area}/${id}?${q}`)
  }

  return (
    <div className="schermata quaderno">
      <TestaQuaderno area={area} titolo={a.nome} indietro={`#/quaderno/${area}`}
        destra={<a href={nuova} className="tasto-piccolo nota-qui" style={{ '--col': areaDa(area).colore }}>+ Nota qui</a>} />
      {a.gruppo && <p className="nota-piccola">Filiale del gruppo <a href={`#/quaderno/${area}/${a.gruppo.id}`}>{a.gruppo.nome}</a></p>}

      {schede.length > 0 && (
        area === 'G' ? (
          <div className="elenco cantieri-quaderno" role="group" aria-label="Cantieri">
            {schede.map((s) => (
              <button key={s.id} type="button" className={'riga capitolo' + (s.id === scelta?.id ? ' scelto' : '') + (s.id === 'generale' ? ' senza' : '')} onClick={() => cambia('cantiere', s.id)}>
                <span className="riga-corpo">
                  <span className="riga-testo">{s.nome}</span>
                  {s.stato && <span className="riga-meta">{{ offerta: 'offerta', active: 'in corso', completed: 'finito', persa: 'persa' }[s.stato] || s.stato}</span>}
                </span>
                <span className="conto-capitolo">{s.n || ''}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="linguette" role="group" aria-label="Mandanti">
            {schede.map((s) => (
              <button key={s.id} type="button" className={'chip' + (s.id === scelta?.id ? ' attivo' : '')} onClick={() => cambia('m', s.id)}>
                {s.nome}{s.aperti > 0 && <span className="rosso"> · {s.aperti}</span>}
              </button>
            ))}
          </div>
        )
      )}

      <label className="interruttore-agenti">
        <input type="checkbox" checked={agenti} onChange={(e) => setAgenti(e.target.checked)} />
        Anche le note degli agenti
      </label>

      {!dellaScheda.length ? <p className="msg">Ancora nessuna nota qui. Tocca "+ Nota qui" per scrivere la prima.</p>
        : !mostrate.length ? (
          <div className="scheda vuota-mie">
            <p className="msg">Qui non hai ancora scritto niente tu.</p>
            <button type="button" className="tasto-piccolo" onClick={() => setAgenti(true)}>Mostra le {nascoste} note degli agenti</button>
          </div>
        ) : (
          <PagineNote note={mostrate} risolvi={risolvi} sede={filiali.length ? (n) => (n.azienda_id !== a.id ? nomeSede[n.azienda_id] : null) : null}
            mandante={area === 'G'} />
        )}
      {mostrate.length > 0 && nascoste > 0 && (
        <button type="button" className="tasto-link" onClick={() => setAgenti(true)}>Ci sono anche {nascoste} note degli agenti: mostrale</button>
      )}
    </div>
  )
}

// Le note per giorno, testo intero. Sui problemi il tasto Risolto; nel Privato i temi da toccare.
function PagineNote({ note, risolvi, sede, mandante, temi, cambiaTema }) {
  const linkNota = useLinkNota()
  return perGiorno(note).map(([g, righe]) => (
    <section key={g} className="giorno-quaderno">
      <h3>{nomeGiorno(g)}</h3>
      {righe.map((n) => {
        const problema = n.sezione === 'problemi'
        const meta = [sede?.(n), n.sezione && nomeSezione[n.sezione], mandante && n.mandante, n.contatto, FONTI[n.fonte]].filter(Boolean)
        return (
          <article key={n.id} className={'pagina-nota' + (problema && !n.risolto_il ? ' problema' : '') + (n.risolto_il ? ' risolta' : '')}>
            <a href={linkNota(n.id)} className="pagina-apri">
              {meta.length > 0 && <span className="riga-meta">{meta.join(' · ')}</span>}
              <span className="pagina-testo">{n.testo}</span>
            </a>
            {(problema || temi) && (
              <div className="pagina-piede">
                {n.risolto_il && <span className="nota-piccola">risolto</span>}
                {temi?.map((t) => (
                  <button key={t.id} type="button" className={'chip piccolo' + (n.temi?.includes(t.id) ? ' attivo' : '')} onClick={() => cambiaTema(n, t)}>{t.nome}</button>
                ))}
                {problema && (
                  <button type="button" className="tasto-risolto" onClick={() => risolvi(n)}>{n.risolto_il ? 'Riapri' : '✓ Risolto'}</button>
                )}
              </div>
            )}
          </article>
        )
      })}
    </section>
  ))
}

// Note di lavoro senza cliente, oppure note private senza capitolo.
function SenzaCapitolo({ area }) {
  const [agenti] = useAgenti()
  const { avvisa } = useApp()
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    if (area === 'P') {
      const [note, capitoli] = await Promise.all([
        sb.from('note').select(`${CAMPI_NOTA},note_temi(capitolo_id)`).eq('area', 'P').is('eliminata_il', null).then(chk),
        sb.from('quaderno_capitoli').select('id,tipo,persona_id,nome').is('eliminata_il', null).order('ordine').then(chk),
      ])
      const persone = new Set(capitoli.filter((c) => c.tipo === 'persona').map((c) => c.persona_id))
      const libere = note.filter((n) => !n.note_temi.length && !n.note_persone.some((p) => persone.has(p.persona_id)))
        .map((n) => ({ ...n, temi: [] }))
      return { note: ordinaNote(libere), temi: capitoli.filter((c) => c.tipo === 'tema') }
    }
    const note = await tutte(() => sb.from('note').select(CAMPI_NOTA).eq('area', area).is('azienda_id', null).is('eliminata_il', null).is('scartata_il', null))
    return { note: ordinaNote(note), temi: null }
  }, [area])
  const risolvi = useRisolvi(ricarica)
  const cambiaTema = async (n, t) => {
    try { chk(await sb.from('note_temi').insert({ nota_id: n.id, capitolo_id: t.id })); avvisa(`Messa in ${t.nome}`); ricarica() } catch (e) { avvisa(messaggioErrore(e)) }
  }
  const mostrate = (dati?.note || []).filter((n) => area === 'P' || agenti || mia(n))
  return (
    <div className="schermata quaderno">
      <TestaQuaderno area={area} titolo={area === 'P' ? 'Senza capitolo' : 'Senza cliente'} indietro={`#/quaderno/${area}`} />
      <Stato carica={carica} errore={errore} vuoto={dati && !mostrate.length ? 'Niente qui: sono tutte al loro posto.' : null}>
        {dati && <PagineNote note={mostrate} risolvi={risolvi} mandante temi={dati.temi} cambiaTema={cambiaTema} />}
      </Stato>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Privato: capitoli per persona e per tema                            */
/* ------------------------------------------------------------------ */
function CapitoliPrivato({ compatto }) {
  const { avvisa } = useApp()
  const [modifica, setModifica] = useState(false)
  const [nuovo, setNuovo] = useState(null) // 'persona' | 'tema'
  const [nome, setNome] = useState('')
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [capitoli, note, personeP] = await Promise.all([
      sb.from('quaderno_capitoli').select('id,tipo,persona_id,nome,ordine,persone(id,nome,cognome)').is('eliminata_il', null).order('ordine').then(chk),
      sb.from('note').select('id,note_persone(persona_id),note_temi(capitolo_id)').eq('area', 'P').is('eliminata_il', null).then(chk),
      sb.from('persone').select(CAMPI_PERSONA).is('eliminata_il', null).order('nome').then(chk),
    ])
    const conto = {}
    const inPersona = new Set(capitoli.filter((c) => c.tipo === 'persona').map((c) => c.persona_id))
    let senza = 0
    for (const n of note) {
      n.note_persone.forEach((p) => { conto[p.persona_id] = (conto[p.persona_id] || 0) + 1 })
      n.note_temi.forEach((t) => { conto[t.capitolo_id] = (conto[t.capitolo_id] || 0) + 1 })
      if (!n.note_temi.length && !n.note_persone.some((p) => inPersona.has(p.persona_id))) senza++
    }
    const scegli = personeP.filter((p) => p.persone_aree?.some((x) => x.area === 'P') && !inPersona.has(p.id))
    return { capitoli, conto, senza, scegli }
  }, [])

  async function aggiungi(valori) {
    try {
      const ordine = Math.max(0, ...(dati?.capitoli || []).map((c) => c.ordine)) + 1
      chk(await sb.from('quaderno_capitoli').insert({ ...valori, ordine }))
      setNuovo(null); setNome('')
      ricarica()
    } catch (e) { avvisa(messaggioErrore(e)) }
  }
  async function togli(c) {
    try {
      chk(await sb.from('quaderno_capitoli').update({ eliminata_il: new Date().toISOString() }).eq('id', c.id))
      avvisa('Capitolo tolto: le note restano', { etichetta: 'Annulla', fai: async () => {
        try { chk(await sb.from('quaderno_capitoli').update({ eliminata_il: null }).eq('id', c.id)); ricarica() } catch (e) { avvisa(messaggioErrore(e)) }
      } })
      ricarica()
    } catch (e) { avvisa(messaggioErrore(e)) }
  }

  const tessera = (c) => {
    const titolo = c.tipo === 'persona' ? nomePersona(c.persone) : c.nome
    const quante = dati.conto[c.tipo === 'persona' ? c.persona_id : c.id] || 0
    return (
      <div key={c.id} className="tessera-capitolo">
        <a href={`#/quaderno/P/${c.tipo}/${c.id}`}>
          <b>{titolo}</b>
          <span className="nota-piccola">{quante} {quante === 1 ? 'nota' : 'note'}</span>
        </a>
        {modifica && <button type="button" className="tasto-link pericolo" onClick={() => togli(c)}>Togli</button>}
      </div>
    )
  }

  return (
    <div className="schermata quaderno">
      <TestaQuaderno area="P" destra={
        <button type="button" className="tasto-piccolo" onClick={() => { setModifica(!modifica); setNuovo(null) }}>{modifica ? 'Fatto' : 'Modifica capitoli'}</button>} />
      <Stato carica={carica} errore={errore}>
        {dati && (
          <>
            {['persona', 'tema'].map((tipo) => (
              <section key={tipo} className="blocco">
                <h3>{tipo === 'persona' ? 'Persone' : 'Temi'}</h3>
                <div className="tessere">
                  {dati.capitoli.filter((c) => c.tipo === tipo).map(tessera)}
                  <button type="button" className="tessera-nuova" onClick={() => { setNuovo(nuovo === tipo ? null : tipo); setNome('') }}>
                    + {tipo === 'persona' ? 'Persona' : 'Tema'}
                  </button>
                </div>
                {nuovo === 'tema' && tipo === 'tema' && (
                  <form className="riga-campo" onSubmit={(e) => { e.preventDefault(); if (nome.trim()) aggiungi({ tipo: 'tema', nome: nome.trim() }) }}>
                    <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome del tema (es. Salute, Scuola)" autoFocus />
                    <button type="submit" className="tasto-piccolo" disabled={!nome.trim()}>Aggiungi</button>
                  </form>
                )}
                {nuovo === 'persona' && tipo === 'persona' && (
                  <div className="scelta-persona">
                    <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Cerca tra le persone del Privato" autoFocus />
                    <div className="chips">
                      {dati.scegli.filter((p) => !nome.trim() || nomePersona(p).toLowerCase().includes(nome.trim().toLowerCase())).slice(0, 20).map((p) => (
                        <button key={p.id} type="button" className="chip" onClick={() => aggiungi({ tipo: 'persona', persona_id: p.id })}>{nomePersona(p)}</button>
                      ))}
                      {!dati.scegli.length && <p className="msg">Tutte le persone del Privato hanno già un capitolo.</p>}
                    </div>
                  </div>
                )}
              </section>
            ))}
            <a href="#/quaderno/P/senza" className="riga capitolo senza">
              <span className="riga-corpo"><span className="riga-testo">Senza capitolo</span></span>
              <span className="conto-capitolo">{dati.senza || ''}</span>
            </a>
            {!compatto && <p className="nota-piccola">Una nota può stare in una persona e in un tema insieme. Togliere un capitolo non cancella le note: tornano in "Senza capitolo".</p>}
          </>
        )}
      </Stato>
    </div>
  )
}

function CapitoloPrivato({ tipo, id }) {
  const { avvisa } = useApp()
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [capitolo, temi] = await Promise.all([
      sb.from('quaderno_capitoli').select('id,tipo,persona_id,nome,persone(id,nome,cognome)').eq('id', id).single().then(chk),
      sb.from('quaderno_capitoli').select('id,nome').eq('tipo', 'tema').is('eliminata_il', null).order('ordine').then(chk),
    ])
    const campi = `${CAMPI_NOTA},note_temi(capitolo_id)`
    const note = capitolo.tipo === 'persona'
      ? (await sb.from('note_persone').select(`note!inner(${campi})`).eq('persona_id', capitolo.persona_id).eq('note.area', 'P').is('note.eliminata_il', null).then(chk)).map((r) => r.note)
      : (await sb.from('note_temi').select(`note!inner(${campi})`).eq('capitolo_id', id).eq('note.area', 'P').is('note.eliminata_il', null).then(chk)).map((r) => r.note)
    return { capitolo, temi, note: ordinaNote(note.map((n) => ({ ...n, temi: n.note_temi.map((t) => t.capitolo_id) }))) }
  }, [id])
  const risolvi = useRisolvi(ricarica)

  async function cambiaTema(n, t) {
    try {
      if (n.temi.includes(t.id)) chk(await sb.from('note_temi').delete().eq('nota_id', n.id).eq('capitolo_id', t.id))
      else chk(await sb.from('note_temi').insert({ nota_id: n.id, capitolo_id: t.id }))
      ricarica()
    } catch (e) { avvisa(messaggioErrore(e)) }
  }

  const titolo = dati ? (dati.capitolo.tipo === 'persona' ? nomePersona(dati.capitolo.persone) : dati.capitolo.nome) : ' '
  const nuova = dati?.capitolo.tipo === 'persona' ? `#/aggiungi?persona=${dati.capitolo.persona_id}&area=P` : `#/aggiungi?tema=${id}&area=P`
  return (
    <div className="schermata quaderno">
      <TestaQuaderno area="P" titolo={titolo} indietro="#/quaderno/P"
        destra={dati && <a href={nuova} className="tasto-piccolo nota-qui" style={{ '--col': areaDa('P').colore }}>+ Nota qui</a>} />
      <Stato carica={carica} errore={errore} vuoto={dati && !dati.note.length ? 'Ancora nessuna nota qui. Tocca "+ Nota qui" per scrivere la prima.' : null}>
        {dati && <PagineNote note={dati.note} risolvi={risolvi} temi={dati.temi} cambiaTema={cambiaTema} />}
      </Stato>
    </div>
  )
}
