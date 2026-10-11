import { useEffect, useState } from 'react'
import { sb, leggi, scrivi } from './supabase'
import { useApp, useCarica, chk, Stato, Indietro } from './componenti'

// Le 6 sezioni come nel gestionale Ceramex: chiave, nome lungo, nome corto.
export const SEZIONI = [
  ['problemi', 'Problemi aperti', 'Problemi'],
  ['campionature', 'Campionature', 'Campioni'],
  ['offerte', 'Offerte', 'Offerte'],
  ['ordini', 'Ordini e cantieri', 'Ordini'],
  ['accordi', 'Accordi e condizioni', 'Accordi'],
  ['comunicazioni', 'Comunicazioni importanti', 'Comunicazioni'],
]
export const nomeSezione = Object.fromEntries(SEZIONI.map(([k, , corto]) => [k, corto]))
const nomeLungo = Object.fromEntries(SEZIONI.map(([k, lungo]) => [k, lungo]))

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const GMAIL = 'https://mail.google.com/mail/?authuser=giovannifabris%40ceramex.ch#all/'

// "09.10" per quest'anno, "09.10.25" per gli anni prima.
function dataBreve(iso) {
  if (!iso) return ''
  const [a, m, g] = iso.slice(0, 10).split('-')
  return a === String(new Date().getFullYear()) ? `${g}.${m}` : `${g}.${m}.${a.slice(2)}`
}

const battesimo = (nome) => (nome || '').trim().split(/\s+/)[0].replace(/\.$/, '')
const iniziali = (nome) => {
  const parole = nome.trim().split(/\s+/)
  return (parole[0][0] + (parole.length > 1 ? parole[parole.length - 1][0] : '')).toUpperCase()
}
const aperto = (n) => n.sezione === 'problemi' && !n.risolto_il

// Legge tutte le righe anche oltre il limite di 1000 per richiesta.
async function tutte(crea) {
  const righe = []
  for (let da = 0; ; da += 1000) {
    const pezzo = chk(await crea().range(da, da + 999))
    righe.push(...pezzo)
    if (pezzo.length < 1000) return righe
  }
}

// Elenco schede: prima chi ha problemi aperti, poi chi ha scritto per ultimo. Le filiali contano nel gruppo.
export function Aziende({ scelta }) {
  const { area } = useApp()
  const [cerca, setCerca] = useState('')

  const { dati, errore, carica } = useCarica(async () => {
    let qa = sb.from('aziende').select('id,nome,area,gruppo_id,ragione_sociale,email,contatti')
      .is('eliminata_il', null).is('unito_in', null)
    if (area !== 'T') qa = qa.eq('area', area)
    const [aziende, note] = await Promise.all([
      qa.then(chk),
      tutte(() => sb.from('note').select('azienda_id,sezione,data,risolto_il')
        .not('azienda_id', 'is', null).is('eliminata_il', null).is('scartata_il', null).order('id')),
    ])
    const capo = Object.fromEntries(aziende.map((a) => [a.id, a.gruppo_id || a.id]))
    const info = Object.fromEntries(aziende.filter((a) => !a.gruppo_id)
      .map((a) => [a.id, { ...a, filiali: [], note: 0, problemi: 0, ultima: '' }]))
    for (const a of aziende) if (a.gruppo_id && info[a.gruppo_id]) info[a.gruppo_id].filiali.push(a)
    for (const n of note) {
      const i = info[capo[n.azienda_id]]
      if (!i) continue
      i.note++
      if (aperto(n)) i.problemi++
      if (n.data > i.ultima) i.ultima = n.data
    }
    return Object.values(info).sort((a, b) =>
      b.problemi - a.problemi || b.ultima.localeCompare(a.ultima) || a.nome.localeCompare(b.nome, 'it'))
  }, [area])

  const testo = cerca.trim().toLowerCase()
  const trova = (a) => [a.nome, a.ragione_sociale, ...(a.email || []), ...(a.contatti || []).map((c) => c.nome)]
    .some((s) => s && s.toLowerCase().includes(testo))
  const visibili = (dati || []).filter((a) => !testo || trova(a) || a.filiali.some(trova))
  const problemi = (dati || []).reduce((s, a) => s + a.problemi, 0)

  return (
    <div className="schermata">
      <Indietro titolo="Aziende" />
      {dati && (
        <p className="nota-piccola conteggio-aziende">
          {dati.length} aziende
          {problemi > 0 && <> · <b className="rosso">{problemi} {problemi === 1 ? 'problema aperto' : 'problemi aperti'}</b></>}
        </p>
      )}
      <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca azienda, persona o email" />
      <Stato carica={carica} errore={errore} vuoto={dati && !visibili.length ? (testo ? `Nessuna azienda con "${cerca.trim()}".` : 'Nessuna azienda qui.') : null}>
        {dati && (
          <div className="elenco">
            {visibili.map((a) => {
              const persone = (a.contatti || []).map((c) => battesimo(c.nome)).filter(Boolean)
              const chi = a.filiali.length ? `Gruppo · ${a.filiali.length} ${a.filiali.length === 1 ? 'filiale' : 'filiali'}`
                : persone.length ? persone.slice(0, 3).join(', ') + (persone.length > 3 ? '…' : '')
                  : a.ragione_sociale && a.ragione_sociale !== a.nome ? a.ragione_sociale : ''
              return (
                <a key={a.id} className={'riga riga-azienda' + (scelta === a.id || a.filiali.some((f) => f.id === scelta) ? ' scelta' : '')}
                  href={`#/azienda/${a.id}`} aria-current={scelta === a.id ? 'page' : undefined}>
                  <span className={'iniziali' + (a.problemi ? ' aperti' : '')} aria-hidden="true">{iniziali(a.nome)}</span>
                  <span className="riga-corpo">
                    <span className="riga-testo">{a.nome}</span>
                    <span className="riga-meta">{[chi, a.note ? `${a.note} note` : 'nessuna nota'].filter(Boolean).join(' · ')}</span>
                  </span>
                  {a.problemi > 0
                    ? <span className="badge-aperti">{a.problemi} {a.problemi === 1 ? 'aperto' : 'aperti'}</span>
                    : <span className="data-breve">{dataBreve(a.ultima)}</span>}
                </a>
              )
            })}
          </div>
        )}
      </Stato>
    </div>
  )
}

// Scheda azienda come nel gestionale Ceramex: filiali, mandanti, sezioni; vista per sezione o per data.
// Per ora si legge soltanto: fino al trasloco le note si correggono nel gestionale Ceramex.
export function Azienda({ id }) {
  const { vai } = useApp()
  const [sede, setSede] = useState(null) // null = tutto il gruppo
  const [mandante, setMandante] = useState(null)
  const [sezione, setSezione] = useState(null) // null = tutte
  const [vista, setVista] = useState(() => leggi('note-vista') || 'sezioni')
  const [risolte, setRisolte] = useState(false)
  const [tutteLePersone, setTutteLePersone] = useState(false)

  const { dati, errore, carica } = useCarica(async () => {
    const [a, filiali] = await Promise.all([
      sb.from('aziende').select('*,gruppo:gruppo_id(id,nome)').eq('id', id).single().then(chk),
      sb.from('aziende').select('id,nome,contatti').eq('gruppo_id', id).is('eliminata_il', null).order('nome').then(chk),
    ])
    const note = await tutte(() => sb.from('note')
      .select('id,azienda_id,testo,mandante,sezione,data,contatto,risolto_il,thread_id')
      .in('azienda_id', [id, ...filiali.map((f) => f.id)]).is('eliminata_il', null).is('scartata_il', null)
      .order('data', { ascending: false }).order('creata_il', { ascending: false }))
    return { a, filiali, note }
  }, [id])

  // Una scheda unita a un'altra porta a quella giusta.
  const unita = dati?.a.unito_in
  useEffect(() => { if (unita) vai(`/azienda/${unita}`) }, [unita, vai])

  if (!dati) {
    return <div className="schermata"><Indietro titolo="Azienda" /><Stato carica={carica} errore={errore} /></div>
  }

  const { a, filiali, note } = dati
  const nomeSede = Object.fromEntries([[a.id, a.nome], ...filiali.map((f) => [f.id, f.nome])])
  const diSede = note.filter((n) => !sede || n.azienda_id === sede)

  // Mandanti con note, dal più usato. Senza mandante = Altro.
  const perMandante = {}
  for (const n of diSede) {
    const m = (perMandante[n.mandante || 'Altro'] ||= { note: 0, aperti: 0 })
    m.note++
    if (aperto(n)) m.aperti++
  }
  const mandanti = Object.entries(perMandante).sort((x, y) => y[1].note - x[1].note)
  const scelto = mandante && perMandante[mandante] ? mandante : mandanti[0]?.[0]
  const diMandante = diSede.filter((n) => (n.mandante || 'Altro') === scelto)

  const cambiaSede = (s) => { setSede(s); setMandante(null); setSezione(null) }
  const cambiaMandante = (m) => { setMandante(m); setSezione(null) }
  const cambiaVista = (v) => { setVista(v); scrivi('note-vista', v) }

  const persone = (sede ? (sede === a.id ? a.contatti : filiali.find((f) => f.id === sede)?.contatti)
    : [...(a.contatti || []), ...filiali.flatMap((f) => f.contatti || [])]) || []

  const conta = (k) => diMandante.filter((n) => n.sezione === k && (k !== 'problemi' || !n.risolto_il)).length
  const risolti = diMandante.filter((n) => n.sezione === 'problemi' && n.risolto_il)
  const filtrate = diMandante.filter((n) => !sezione || n.sezione === sezione)
  const mostraSede = !sede && filiali.length > 0

  const riga = (n, conSezione) => (
    <NotaCliente key={n.id} n={n} conSezione={conSezione}
      sede={mostraSede && n.azienda_id !== a.id ? nomeSede[n.azienda_id] : null} />
  )
  const tastoRisolti = (testo) => risolti.length > 0 && (
    <button type="button" className="tasto-link" onClick={() => setRisolte(!risolte)}>
      {risolte ? testo[1] : testo[0]}
    </button>
  )

  return (
    <div className="schermata scheda-azienda">
      <Indietro titolo={a.nome} />
      {a.ragione_sociale && a.ragione_sociale !== a.nome && <p className="nota-piccola">{a.ragione_sociale}</p>}
      {a.gruppo && <p className="nota-piccola">Filiale del gruppo <a href={`#/azienda/${a.gruppo.id}`}>{a.gruppo.nome}</a></p>}

      {persone.length > 0 && (
        <div className="chips persone">
          {(tutteLePersone ? persone : persone.slice(0, 4)).map((c, i) => (
            <span key={i} className="chip piccolo" title={[c.nome, c.ruolo, c.email].filter(Boolean).join(' · ')}>
              {tutteLePersone ? [c.nome, c.ruolo].filter(Boolean).join(' · ') : battesimo(c.nome)}
            </span>
          ))}
          {persone.length > 4 && (
            <button type="button" className="chip piccolo" onClick={() => setTutteLePersone(!tutteLePersone)}>
              {tutteLePersone ? 'Meno' : `+${persone.length - 4}`}
            </button>
          )}
        </div>
      )}

      {filiali.length > 0 && (
        <div className="linguette" role="group" aria-label="Filiali">
          {[[null, 'Tutto il gruppo', note.length], ...[a, ...filiali].map((f) => [f.id, f.nome, note.filter((n) => n.azienda_id === f.id).length])]
            .map(([k, nome, quante]) => (
              <button key={k || 'tutto'} type="button" disabled={!quante}
                className={'chip' + (sede === k ? ' attivo' : '')} onClick={() => cambiaSede(k)}>
                {nome} <span className="numero">{quante}</span>
              </button>
            ))}
        </div>
      )}

      {!mandanti.length ? <p className="msg">Ancora nessuna nota.</p> : (
        <>
          <div className="linguette mandanti" role="group" aria-label="Mandanti">
            {mandanti.map(([m, c]) => (
              <button key={m} type="button" className={'mandante' + (scelto === m ? ' attivo' : '')} onClick={() => cambiaMandante(m)}>
                <b>{m}</b>
                <span>{c.note} {c.note === 1 ? 'nota' : 'note'}{c.aperti > 0 && <span className="rosso"> · {c.aperti} {c.aperti === 1 ? 'aperto' : 'aperti'}</span>}</span>
              </button>
            ))}
          </div>

          <div className="barra-vista">
            <div className="segmenti" role="group" aria-label="Vista">
              <button type="button" className={vista === 'sezioni' ? 'attivo' : ''} onClick={() => cambiaVista('sezioni')}>Per sezione</button>
              <button type="button" className={vista === 'data' ? 'attivo' : ''} onClick={() => cambiaVista('data')}>Per data</button>
            </div>
            <span className="nota-piccola">{diMandante.length} {diMandante.length === 1 ? 'nota' : 'note'}</span>
          </div>

          <div className="linguette" role="group" aria-label="Sezioni">
            <button type="button" className={'chip' + (!sezione ? ' attivo' : '')} onClick={() => setSezione(null)}>
              Tutte <span className="numero">{diMandante.length}</span>
            </button>
            {SEZIONI.map(([k, , corto]) => {
              const quante = conta(k)
              const vuota = !quante && !(k === 'problemi' && risolti.length)
              return (
                <button key={k} type="button" disabled={vuota}
                  className={'chip' + (sezione === k ? ' attivo' : '') + (k === 'problemi' && quante ? ' chip-problemi' : '')}
                  onClick={() => setSezione(k)}>
                  {corto} <span className="numero">{quante}</span>
                </button>
              )
            })}
          </div>

          {vista === 'sezioni' ? (
            SEZIONI.filter(([k]) => !sezione || sezione === k).map(([k]) => {
              const righe = k === 'problemi'
                ? diMandante.filter((n) => n.sezione === k && (risolte || !n.risolto_il))
                : diMandante.filter((n) => n.sezione === k)
              if (k !== 'problemi' && !righe.length) return null
              const aperti = k === 'problemi' ? conta(k) : righe.length
              return (
                <section key={k} className={'blocco' + (k === 'problemi' ? ' blocco-problemi' : '')}>
                  <h2><span>{nomeLungo[k]}</span><span className="numero">{aperti}</span></h2>
                  {k === 'problemi' && !righe.length
                    ? <p className="msg">Nessun problema aperto.</p>
                    : <div className="elenco">{righe.map((n) => riga(n, false))}</div>}
                  {k === 'problemi' && tastoRisolti([`Mostra ${risolti.length} ${risolti.length === 1 ? 'problema risolto' : 'problemi risolti'}`, 'Nascondi i risolti'])}
                </section>
              )
            })
          ) : (
            <>
              {perMese(filtrate.filter((n) => risolte || !n.risolto_il)).map(([mese, righe]) => (
                <section key={mese} className="blocco">
                  <h3>{mese}</h3>
                  <div className="elenco">{righe.map((n) => riga(n, true))}</div>
                </section>
              ))}
              {(!sezione || sezione === 'problemi') && tastoRisolti([`Mostra anche ${risolti.length} ${risolti.length === 1 ? 'problema risolto' : 'problemi risolti'}`, 'Nascondi i problemi risolti'])}
            </>
          )}
        </>
      )}
    </div>
  )
}

// Raggruppa per mese: "Ottobre" quest'anno, "Marzo 2025" gli anni prima.
function perMese(note) {
  const anno = String(new Date().getFullYear())
  const gruppi = []
  for (const n of note) {
    const [a, m] = (n.data || '').split('-')
    const nome = a ? MESI[Number(m) - 1] + (a === anno ? '' : ` ${a}`) : 'Senza data'
    const ultimo = gruppi[gruppi.length - 1]
    if (ultimo?.[0] === nome) ultimo[1].push(n)
    else gruppi.push([nome, [n]])
  }
  return gruppi
}

function NotaCliente({ n, conSezione, sede }) {
  const meta = sede || n.contatto || conSezione
  return (
    <div className={'nota-cliente' + (n.risolto_il ? ' risolta' : '')}>
      <span className="data-breve">{dataBreve(n.data)}</span>
      <div className="nota-corpo">
        <p className="nota-testo">
          {meta && (
            <span className="nota-meta">
              {sede && <span className="etichetta-sede">{sede}</span>}
              {n.contatto && <b>{n.contatto} —</b>}
              {conSezione && <span className={'etichetta-sezione' + (aperto(n) ? ' rosso' : '')}>{nomeSezione[n.sezione]}</span>}
            </span>
          )}
          {n.testo}
        </p>
        {(n.risolto_il || n.thread_id) && (
          <p className="nota-piede">
            {n.risolto_il && <span>risolto il {dataBreve(n.risolto_il)}</span>}
            {n.thread_id && <a href={GMAIL + n.thread_id} target="_blank" rel="noopener noreferrer">dalla mail</a>}
          </p>
        )}
      </div>
    </div>
  )
}
