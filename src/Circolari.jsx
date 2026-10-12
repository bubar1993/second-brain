import { useEffect } from 'react'
import { sb, areaDa, quando } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro } from './componenti'

// Circolari (13.10.2026): le mail dei mandanti (Ceramex) e dei fornitori (G&C) che non riguardano un cliente:
// listini, aumenti, novità, condizioni, ferie, fiere. Le raccoglie l'agente "Da seguire", divise per mandante.
// Se c'è una data importante (es. aumento dal 1.1), "Ricordamelo" la mette nei promemoria.

const GMAIL_WEB = 'https://mail.google.com/mail/?authuser=giovannifabris%40ceramex.ch#all/'
const aree = (area) => (area === 'C' || area === 'G' ? [area] : ['C', 'G'])

export async function contaCircolari(area) {
  if (area === 'P') return 0
  const { count } = await sb.from('circolari').select('id', { count: 'exact', head: true }).in('area', aree(area)).is('letta_il', null)
  return count || 0
}

export function Circolari() {
  const { area, avvisa } = useApp()
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    if (area === 'P') return []
    const da = new Date(Date.now() - 120 * 86400000).toISOString()
    return chk(await sb.from('circolari').select('id,area,mandante,data,oggetto,riassunto,importante,scadenza,scadenza_testo,message_id,gmail_thread_id,letta_il,promemoria_id')
      .in('area', aree(area)).gte('data', da).order('data', { ascending: false }).limit(150))
  }, [area])

  // Aperta la schermata, le nuove contano come lette (restano evidenziate finché non esci).
  useEffect(() => {
    const nuove = (dati || []).filter((c) => !c.letta_il).map((c) => c.id)
    if (!nuove.length) return
    const t = setTimeout(() => { sb.from('circolari').update({ letta_il: new Date().toISOString() }).in('id', nuove).then(() => {}) }, 1500)
    return () => clearTimeout(t)
  }, [dati])

  async function ricordamelo(c) {
    try {
      const [p] = chk(await sb.from('promemoria').insert({
        area: c.area, testo: c.scadenza_testo || `${c.mandante}: ${c.oggetto || 'circolare'}`, scade_il: new Date(`${c.scadenza}T08:00`).toISOString(),
      }).select('id'))
      chk(await sb.from('circolari').update({ promemoria_id: p.id }).eq('id', c.id))
      avvisa(`Te lo ricordo ${quando(c.scadenza)}`)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  if (area === 'P') {
    return (
      <div className="schermata">
        <Indietro titolo="Circolari" />
        <p className="msg">Le circolari sono di Ceramex e G&C: scegli una delle due aree in alto.</p>
      </div>
    )
  }

  // Un gruppo per mandante/fornitore, prima quello con la circolare più recente.
  const gruppi = []
  for (const c of dati || []) {
    const k = `${c.area}|${c.mandante}`
    let g = gruppi.find((x) => x.k === k)
    if (!g) gruppi.push(g = { k, area: c.area, mandante: c.mandante, righe: [] })
    g.righe.push(c)
  }

  return (
    <div className="schermata">
      <Indietro titolo="Circolari" />
      <p className="nota-piccola">Listini, aumenti, novità e comunicazioni {area === 'G' ? 'dei fornitori' : area === 'C' ? 'dei mandanti' : 'di mandanti e fornitori'} degli ultimi 4 mesi.</p>
      <Stato carica={carica} errore={errore} vuoto={dati?.length === 0 ? 'Nessuna circolare per ora. L\'agente le cerca ogni 2 ore.' : null}>
        {gruppi.map((g) => (
          <section key={g.k} className="gruppo-circolari">
            <h2 style={{ '--c': areaDa(g.area)?.colore }}>{g.mandante}</h2>
            {g.righe.map((c) => (
              <article key={c.id} className={'ordine circolare' + (c.letta_il ? '' : ' nuova') + (c.importante ? ' importante' : '')}>
                <div className="ordine-testa">
                  <span className="ordine-cliente">{c.oggetto || 'Circolare'}</span>
                  <span className="data-breve">{quando(c.data)}</span>
                </div>
                <p>{c.riassunto}</p>
                <div className="azioni">
                  {c.scadenza && !c.promemoria_id && (
                    <button type="button" className="tasto-piccolo" onClick={() => ricordamelo(c)}>Ricordamelo {quando(c.scadenza)}</button>
                  )}
                  {c.promemoria_id && <span className="nota-piccola">Promemoria messo per {quando(c.scadenza)}</span>}
                  {c.area === 'C' && c.gmail_thread_id && <a className="nota-piccola" href={GMAIL_WEB + c.gmail_thread_id} target="_blank" rel="noreferrer">Apri in Gmail</a>}
                  {c.area === 'G' && <a className="nota-piccola" href={`#/mail/${encodeURIComponent(c.message_id)}`}>Apri la mail</a>}
                </div>
              </article>
            ))}
          </section>
        ))}
      </Stato>
    </div>
  )
}
