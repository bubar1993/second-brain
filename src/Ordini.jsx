import { useState } from 'react'
import { sb, quando } from './supabase'
import { useCarica, chk, Stato, Indietro, Icona } from './componenti'

// Ordini Marazzi degli ultimi 2 giorni (12.10.2026, solo Ceramex): cliente, cosa ha ordinato e se è disponibile.
// Le conferme le trova la funzione ordini-marazzi, le legge la routine "Ordini Marazzi"; le più vecchie
// restano solo nella scheda del cliente (sezione ordini).
// "Cerca" (13.10.2026, richiesta di Giovanni): in tutti gli ordini, per cliente/rif./numero, articolo (nome, codice, formato),
// metri quadri (da–a: vale la riga dell'articolo cercato, altrimenti il totale dell'ordine), disponibilità e periodo.

const GMAIL_WEB = 'https://mail.google.com/mail/?authuser=giovannifabris%40ceramex.ch#all/'

// Inizio dei "2 giorni lavorativi" (scelta di Giovanni): oggi e il giorno lavorativo prima.
// Il lunedì si vedono ancora gli ordini del venerdì; sabato e domenica non contano.
function inizioDueGiorniLavorativi(oggi = new Date()) {
  const d = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate())
  const lavorativo = (x) => x.getDay() !== 0 && x.getDay() !== 6
  if (!lavorativo(d)) while (!lavorativo(d)) d.setDate(d.getDate() - 1) // nel weekend: da venerdì
  d.setDate(d.getDate() - 1)
  while (!lavorativo(d)) d.setDate(d.getDate() - 1)
  return d
}
const DISPONIBILE = { si: ['disponibile', 'verde'], in_parte: ['disponibile in parte', 'giallo'], no: ['non ancora disponibile', 'rosso'] }

const VUOTO = { cliente: '', articolo: '', da: '', a: '', disp: '', dal: '', al: '' }
const m2 = (righe) => (righe || []).filter((r) => /m2|m²|mq/i.test(r.unita || '')).reduce((s, r) => s + (Number(r.quantita) || 0), 0)
const numero = (v) => (v === '' ? null : Number(String(v).replace(/'/g, '').replace(',', '.')))

function filtra(ordini, f) {
  const cliente = f.cliente.trim().toLowerCase()
  const articolo = f.articolo.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const da = numero(f.da)
  const a = numero(f.a)
  const nelRange = (q) => (da === null || q >= da) && (a === null || q <= a)
  return ordini.flatMap((o) => {
    if (cliente && ![o.aziende?.nome, o.cliente, o.riferimento, ...(o.numeri || [])].some((x) => String(x || '').toLowerCase().includes(cliente))) return []
    if (f.disp && o.disponibile !== f.disp) return []
    const giorno = (o.data || '').slice(0, 10)
    if (f.dal && giorno < f.dal) return []
    if (f.al && giorno > f.al) return []
    let trovate = null
    if (articolo.length) {
      trovate = (o.righe || []).filter((r) => {
        const testo = [r.articolo, r.codice, r.formato].join(' ').toLowerCase()
        return articolo.every((p) => testo.includes(p)) && nelRange(Number(r.quantita) || 0)
      })
      if (!trovate.length) return []
    } else if ((da !== null || a !== null) && !nelRange(m2(o.righe))) return []
    return [{ ...o, trovate }]
  })
}

export function Ordini() {
  const [cerca, setCerca] = useState(false)
  const [f, setF] = useState(VUOTO)
  const attivo = cerca && Object.values(f).some((v) => v !== '')
  const { dati, errore, carica } = useCarica(async () => {
    let q = sb.from('ordini_marazzi')
      .select('id,data,oggetto,numeri,riferimento,cliente,righe,riepilogo,disponibile,stato,errore,gmail_thread_id,aziende(id,nome)')
      .order('data', { ascending: false })
    if (!cerca) q = q.gte('data', inizioDueGiorniLavorativi().toISOString())
    return chk(await q.limit(2000))
  }, [cerca])
  const mostrati = dati ? (attivo ? filtra(dati, f) : dati) : null
  const metti = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  return (
    <div className="schermata">
      <div className="testata-con-tasto">
        <Indietro titolo="Ordini Marazzi" />
        <button type="button" className={'tasto-piccolo' + (cerca ? ' attivo' : '')} onClick={() => { setCerca(!cerca); setF(VUOTO) }}>
          {cerca ? 'Chiudi' : <><Icona nome="cerca" size={16} /> Cerca</>}
        </button>
      </div>
      {cerca ? (
        <form className="cerca-ordini" onSubmit={(e) => e.preventDefault()}>
          <input type="search" value={f.cliente} onChange={metti('cliente')} placeholder="Cliente, riferimento o n. d'ordine" />
          <input type="search" value={f.articolo} onChange={metti('articolo')} placeholder="Articolo, codice o formato (es. Mystone 60x120)" />
          <div className="riga-campo">
            <input inputMode="decimal" value={f.da} onChange={metti('da')} placeholder="m² da" aria-label="Metri quadri da" />
            <input inputMode="decimal" value={f.a} onChange={metti('a')} placeholder="m² a" aria-label="Metri quadri a" />
          </div>
          <div className="linguette" role="group" aria-label="Disponibilità">
            {[['', 'Tutti'], ['si', 'Disponibili'], ['in_parte', 'In parte'], ['no', 'Non ancora']].map(([k, t]) => (
              <button key={k || 'tutti'} type="button" className={'chip' + (f.disp === k ? ' attivo' : '')} onClick={() => setF((x) => ({ ...x, disp: k }))}>{t}</button>
            ))}
          </div>
          <div className="riga-campo">
            <label className="campo-data">Dal<input type="date" value={f.dal} onChange={metti('dal')} /></label>
            <label className="campo-data">Al<input type="date" value={f.al} onChange={metti('al')} /></label>
          </div>
          <p className="nota-piccola">
            Cerca in tutti gli ordini. I metri quadri valgono per la riga dell'articolo cercato; senza articolo, per tutto l'ordine.
            {mostrati && attivo && ` Trovati: ${mostrati.length}.`}
          </p>
        </form>
      ) : (
        <p className="nota-piccola">Le conferme d'ordine di oggi e del giorno lavorativo prima. Le più vecchie restano nella scheda del cliente, sezione Ordini, e si trovano con Cerca.</p>
      )}
      <Stato carica={carica} errore={errore}
        vuoto={mostrati?.length === 0 ? (cerca ? (attivo ? 'Nessun ordine con questi filtri.' : 'Ancora nessun ordine.') : 'Nessuna conferma d\'ordine negli ultimi 2 giorni lavorativi.') : null}>
        {mostrati && (
          <div className="ordini">
            {mostrati.map((o) => {
              const disp = DISPONIBILE[o.disponibile]
              const cliente = o.aziende?.nome || o.cliente
              return (
                <section key={o.id} className="ordine">
                  <div className="ordine-testa">
                    {o.aziende ? <a className="ordine-cliente" href={`#/azienda/${o.aziende.id}`}>{cliente}</a>
                      : <span className="ordine-cliente">{cliente || 'Cliente da capire'}</span>}
                    <span className="data-breve">{quando(o.data, true)}</span>
                  </div>
                  <p className="riga-meta">
                    Ordine {o.numeri.join(', ')}{o.riferimento ? ` · rif. ${o.riferimento}` : ''}
                    {m2(o.righe) > 0 && ` · ${m2(o.righe).toLocaleString('de-CH', { maximumFractionDigits: 2 })} m²`}
                    {disp && <> · <span className={disp[1]}>{disp[0]}</span></>}
                  </p>
                  {o.stato === 'da_leggere' && <p className="nota-piccola">Arrivata da poco: l'agente la legge entro un'ora.</p>}
                  {o.stato === 'errore' && <p className="nota-piccola rosso">{o.errore || 'Non sono riuscito a leggerla'}: aprila in Gmail.</p>}
                  {o.righe?.length > 0 && (
                    <ul className="ordine-righe">
                      {o.righe.map((r, i) => (
                        <li key={i} className={o.trovate?.includes(r) ? 'trovata' : undefined}>
                          <span>{[r.articolo, r.formato].filter(Boolean).join(' ')}</span>
                          <span className="ordine-quanto">{r.quantita} {r.unita}</span>
                          {r.disponibilita && <span className={'ordine-disp' + (/^disponibile$/i.test(r.disponibilita) ? ' verde' : '')}>{r.disponibilita}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.gmail_thread_id && <a className="nota-piccola" href={GMAIL_WEB + o.gmail_thread_id} target="_blank" rel="noreferrer">Apri in Gmail</a>}
                </section>
              )
            })}
          </div>
        )}
      </Stato>
    </div>
  )
}
