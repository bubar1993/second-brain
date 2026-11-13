import { useEffect, useState } from 'react'
import { sb, areaDa, quando } from './supabase'
import { useApp, useCarica, useModifiche, chk, messaggioErrore, Stato, Indietro } from './componenti'

// Circolari (13.10.2026): le mail dei mandanti (Ceramex) e dei fornitori (G&C) che non riguardano un cliente:
// listini, aumenti, novità, condizioni, ferie, fiere. Le raccoglie l'agente "Da seguire", divise per mandante.
// Se c'è una data importante (es. aumento dal 1.1), "Ricordamelo" la mette nei promemoria.
// Modifica e Cancella (13.11.2026): "Cancella" la nasconde soltanto (nascosta_il), così l'agente non la rimette;
// il promemoria già messo resta (scelta di Giovanni). Il mandante non si modifica: serve uguale al Quaderno.

const GMAIL_WEB = 'https://mail.google.com/mail/?authuser=giovannifabris%40ceramex.ch#all/'
const aree = (area) => (area === 'C' || area === 'G' ? [area] : ['C', 'G'])

export async function contaCircolari(area) {
  if (area === 'P') return 0
  const { count } = await sb.from('circolari').select('id', { count: 'exact', head: true }).in('area', aree(area)).is('letta_il', null).is('nascosta_il', null)
  return count || 0
}

export function Circolari() {
  const { area, avvisa } = useApp()
  const [aperta, setAperta] = useState(null)
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    if (area === 'P') return []
    const da = new Date(Date.now() - 120 * 86400000).toISOString()
    return chk(await sb.from('circolari').select('id,area,mandante,data,oggetto,riassunto,importante,scadenza,scadenza_testo,message_id,gmail_thread_id,letta_il,promemoria_id,promemoria:promemoria_id(scade_il)')
      .in('area', aree(area)).is('nascosta_il', null).gte('data', da).order('data', { ascending: false }).limit(150))
  }, [area])

  async function cancella(c) {
    try {
      chk(await sb.from('circolari').update({ nascosta_il: new Date().toISOString() }).eq('id', c.id))
      avvisa('Circolare tolta', { etichetta: 'Annulla', fai: async () => {
        try { chk(await sb.from('circolari').update({ nascosta_il: null }).eq('id', c.id)); ricarica() } catch (e) { avvisa(messaggioErrore(e)) }
      } })
      setAperta(null)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  // Se cambiano data o testo e il promemoria c'è già, si sposta anche quello. Data svuotata: il promemoria resta.
  async function salva(c, v) {
    try {
      chk(await sb.from('circolari').update(v).eq('id', c.id))
      if (c.promemoria_id) {
        const p = {}
        if (v.scadenza && v.scadenza !== c.scadenza) p.scade_il = new Date(`${v.scadenza}T08:00`).toISOString()
        if (v.scadenza_testo && v.scadenza_testo !== (c.scadenza_testo || '')) p.testo = v.scadenza_testo
        if (Object.keys(p).length) chk(await sb.from('promemoria').update(p).eq('id', c.promemoria_id))
      }
      avvisa('Salvato')
      setAperta(null)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

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
                {aperta === c.id
                  ? <ModificaCircolare c={c} salva={salva} cancella={cancella} chiudi={() => setAperta(null)} />
                  : <>
                    <p>{c.riassunto}</p>
                    <div className="azioni">
                      {c.scadenza && !c.promemoria_id && (
                        <button type="button" className="tasto-piccolo" onClick={() => ricordamelo(c)}>Ricordamelo {quando(c.scadenza)}</button>
                      )}
                      {c.promemoria_id && c.promemoria?.scade_il && <span className="nota-piccola">Promemoria messo per {quando(c.promemoria.scade_il)}</span>}
                      {c.area === 'C' && c.gmail_thread_id && <a className="nota-piccola" href={GMAIL_WEB + c.gmail_thread_id} target="_blank" rel="noreferrer">Apri in Gmail</a>}
                      {c.area === 'G' && <a className="nota-piccola" href={`#/mail/${encodeURIComponent(c.message_id)}`}>Apri la mail</a>}
                      <button type="button" className="tasto-link a-destra" onClick={() => setAperta(c.id)}>Modifica</button>
                      <button type="button" className="tasto-link pericolo" onClick={() => cancella(c)}>Cancella</button>
                    </div>
                  </>}
              </article>
            ))}
          </section>
        ))}
      </Stato>
    </div>
  )
}

// La circolare aperta: correggi oggetto, riassunto, data da ricordare e testo del promemoria.
function ModificaCircolare({ c, salva, cancella, chiudi }) {
  const [oggetto, setOggetto] = useState(c.oggetto || '')
  const [riassunto, setRiassunto] = useState(c.riassunto || '')
  const [scadenza, setScadenza] = useState(c.scadenza || '')
  const [testo, setTesto] = useState(c.scadenza_testo || '')
  const cambiato = oggetto !== (c.oggetto || '') || riassunto !== (c.riassunto || '') || scadenza !== (c.scadenza || '') || testo !== (c.scadenza_testo || '')
  useModifiche(cambiato)

  function ok() {
    if (!riassunto.trim()) return
    salva(c, { oggetto: oggetto.trim() || null, riassunto: riassunto.trim(), scadenza: scadenza || null, scadenza_testo: testo.trim() || null })
  }

  return (
    <div className="modifica-promemoria modifica-circolare">
      <label className="campo">Oggetto<input type="text" value={oggetto} onChange={(e) => setOggetto(e.target.value)} /></label>
      <label className="campo">Riassunto<textarea value={riassunto} onChange={(e) => setRiassunto(e.target.value)} rows={5} /></label>
      <label className="campo">Data da ricordare<input type="date" value={scadenza} onChange={(e) => setScadenza(e.target.value)} /></label>
      {scadenza && <label className="campo">Testo del promemoria<input type="text" value={testo} onChange={(e) => setTesto(e.target.value)} placeholder={`${c.mandante}: ${oggetto || 'circolare'}`} /></label>}
      {c.promemoria_id && <p className="nota-piccola">{scadenza ? 'Se cambi data o testo, sposto anche il promemoria.' : 'Senza data il promemoria già messo resta com\'è.'}</p>}
      {!riassunto.trim() && <p className="nota-piccola rosso">Il riassunto non può restare vuoto.</p>}
      <div className="azioni">
        {cambiato && riassunto.trim() && <button type="button" className="tasto-piccolo tasto-salva" onClick={ok}>Salva</button>}
        <button type="button" className="tasto-link" onClick={chiudi}>Chiudi</button>
        <button type="button" className="tasto-link pericolo" onClick={() => cancella(c)}>Cancella</button>
      </div>
    </div>
  )
}
