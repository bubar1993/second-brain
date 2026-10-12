import { sb, quando } from './supabase'
import { useCarica, chk, Stato, Indietro } from './componenti'

// Ordini Marazzi degli ultimi 2 giorni (12.10.2026, solo Ceramex): cliente, cosa ha ordinato e se è disponibile.
// Le conferme le trova la funzione ordini-marazzi, le legge la routine "Ordini Marazzi"; le più vecchie
// restano solo nella scheda del cliente (sezione ordini).

const GMAIL_WEB = 'https://mail.google.com/mail/?authuser=giovannifabris%40ceramex.ch#all/'
const DISPONIBILE = { si: ['disponibile', 'verde'], in_parte: ['disponibile in parte', 'giallo'], no: ['non ancora disponibile', 'rosso'] }

export function Ordini() {
  const { dati, errore, carica } = useCarica(async () => chk(
    await sb.from('ordini_marazzi')
      .select('id,data,oggetto,numeri,riferimento,cliente,righe,riepilogo,disponibile,stato,errore,gmail_thread_id,aziende(id,nome)')
      .gte('data', new Date(Date.now() - 2 * 86400000).toISOString())
      .order('data', { ascending: false }),
  ), [])

  return (
    <div className="schermata">
      <Indietro titolo="Ordini Marazzi" />
      <p className="nota-piccola">Le conferme d'ordine degli ultimi 2 giorni. Le più vecchie restano nella scheda del cliente, sezione Ordini.</p>
      <Stato carica={carica} errore={errore} vuoto={dati?.length === 0 ? 'Nessuna conferma d\'ordine negli ultimi 2 giorni.' : null}>
        {dati && (
          <div className="ordini">
            {dati.map((o) => {
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
                    {disp && <> · <span className={disp[1]}>{disp[0]}</span></>}
                  </p>
                  {o.stato === 'da_leggere' && <p className="nota-piccola">Arrivata da poco: l'agente la legge entro un'ora.</p>}
                  {o.stato === 'errore' && <p className="nota-piccola rosso">{o.errore || 'Non sono riuscito a leggerla'}: aprila in Gmail.</p>}
                  {o.righe?.length > 0 && (
                    <ul className="ordine-righe">
                      {o.righe.map((r, i) => (
                        <li key={i}>
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
