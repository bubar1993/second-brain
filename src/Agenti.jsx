import { useEffect, useState } from 'react'
import { sb, quando } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Indietro, Icona, useModifiche } from './componenti'

// Schermata "Agenti" (12.10.2026): un posto solo per vedere cosa fanno gli agenti e scrivergli.
// "Fallo adesso" fa partire subito la routine (funzione agente-subito); altrimenti la richiesta
// la legge il giro programmato. L'agente risponde nella stessa riga di richieste_agenti.

export const AGENTI = [
  { codice: 'lavoro', nome: 'Agente lavoro', cosa: 'Note di Ceramex e G&C, Inbox, persone, punto del mattino e della sera', registro: 'agente-lavoro', aree: ['C', 'G'], orari: 'ogni ora, dalle 7 alle 22' },
  { codice: 'ceramex', nome: 'Bozze mail Ceramex', cosa: 'Bozze di risposta nella tua Gmail e note dalle mail Ceramex', registro: 'agente-ceramex', aree: ['C'], orari: 'ogni mezz\'ora nei giorni feriali (8–19), ogni 2 ore nel weekend' },
  { codice: 'gc', nome: 'Agente G&C', cosa: 'Mail di info@: note e bozze di risposta', registro: 'agente-gc', aree: ['G'], orari: 'ogni mezz\'ora, dalle 7 alle 22' },
  { codice: 'calendario', nome: 'Agente calendario', cosa: 'Google Calendar: copia gli appuntamenti, i colori, gli spostamenti e quelli nuovi', registro: 'agente-calendario', aree: ['C', 'G', 'P'], orari: 'ogni ora, dalle 6 alle 22' },
  { codice: 'privato', nome: 'Agente privato', cosa: 'Note private, gemelli, scadenze, compleanni', registro: 'agente-privato', aree: ['P'], orari: 'ogni ora, dalle 7 alle 22' },
]

const IN_ATTESA = ['nuova', 'avviata', 'in_corso']
const STATI = { nuova: 'in attesa del prossimo giro', avviata: 'partito, arriva tra poco', in_corso: 'ci sta lavorando', fatta: 'fatto', non_fatta: 'non fatto' }

// Il riepilogo di un giro: quello scritto dall'agente, altrimenti i numeri.
function riepilogo(r) {
  const d = r?.dettagli || {}
  if (d.riepilogo) return d.riepilogo
  const numeri = Object.entries(d).filter(([, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
  return numeri.length ? numeri.join(' · ') : 'niente di nuovo'
}

export function Agenti() {
  const { area } = useApp()
  const visibili = AGENTI.filter((a) => area === 'T' || a.aree.includes(area))
  const { dati, errore, carica } = useCarica(async () => {
    const [giri, richieste] = await Promise.all([
      Promise.all(visibili.map((a) => sb.from('lavori_registro').select('lavoro,iniziata_il,ok,errore,dettagli')
        .eq('lavoro', a.registro).order('id', { ascending: false }).limit(1).then(chk))),
      sb.from('richieste_agenti').select('agente,stato,vista_il,risposta_il')
        .or('stato.in.(nuova,avviata,in_corso),and(risposta_il.not.is.null,vista_il.is.null)').then(chk),
    ])
    return { giri: giri.map((g) => g[0] || null), richieste }
  }, [area])

  return (
    <div className="schermata">
      <Indietro titolo="Agenti" />
      <p className="nota-piccola">Cosa fanno gli agenti e quando hanno girato. Tocca un agente per scrivergli.</p>
      <Stato carica={carica} errore={errore}>
        {dati && (
          <div className="elenco">
            {visibili.map((a, i) => {
              const g = dati.giri[i]
              const nuove = dati.richieste.filter((r) => r.agente === a.codice && r.risposta_il && !r.vista_il).length
              const attesa = dati.richieste.some((r) => r.agente === a.codice && IN_ATTESA.includes(r.stato))
              return (
                <a key={a.codice} className="riga voce" href={`#/agente/${a.codice}`}>
                  <span className="riga-corpo">
                    <span className="riga-testo">{a.nome}</span>
                    <span className="riga-meta">
                      {g ? <>Ultimo giro {quando(g.iniziata_il, true)}{!g.ok && <span className="rosso"> · errore</span>}</> : 'Nessun giro registrato'}
                      {attesa && ' · sta lavorando a una tua richiesta'}
                    </span>
                    {g && <span className="riga-meta">{g.ok ? riepilogo(g) : g.errore}</span>}
                  </span>
                  {nuove > 0 && <span className="numero-voce">{nuove}</span>}
                  <Icona nome="freccia" size={18} />
                </a>
              )
            })}
          </div>
        )}
      </Stato>
    </div>
  )
}

export function Agente({ codice }) {
  const { avvisa } = useApp()
  const a = AGENTI.find((x) => x.codice === codice)
  const [testo, setTesto] = useState('')
  const [lavoro, setLavoro] = useState(false)
  useModifiche(!!testo.trim())

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [richieste, giri] = await Promise.all([
      sb.from('richieste_agenti').select('*').eq('agente', codice).order('creata_il', { ascending: false }).limit(15).then(chk),
      sb.from('lavori_registro').select('id,iniziata_il,ok,errore,dettagli').eq('lavoro', a?.registro || '-')
        .order('id', { ascending: false }).limit(8).then(chk),
    ])
    return { richieste, giri }
  }, [codice])

  // Le risposte che vedi qui contano come lette.
  useEffect(() => {
    if (!dati?.richieste.some((r) => r.risposta_il && !r.vista_il)) return
    sb.from('richieste_agenti').update({ vista_il: new Date().toISOString() })
      .eq('agente', codice).not('risposta_il', 'is', null).is('vista_il', null).then(() => {})
  }, [dati, codice])

  // Finché l'agente ci lavora, la pagina si aggiorna da sola.
  const attesa = dati?.richieste.some((r) => IN_ATTESA.includes(r.stato))
  useEffect(() => {
    if (!attesa) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') ricarica() }, 15000)
    return () => clearInterval(t)
  }, [attesa, ricarica])

  if (!a) return <div className="schermata"><Indietro titolo="Agente" /><p className="msg">Agente non trovato.</p></div>

  async function invia(subito) {
    const t = testo.trim()
    if (!t) return avvisa('Scrivi cosa deve fare')
    setLavoro(true)
    try {
      const r = chk(await sb.from('richieste_agenti').insert({ agente: codice, testo: t }).select('id').single())
      setTesto('')
      if (!subito) {
        avvisa('Lo fa al prossimo giro')
      } else {
        const esito = await chiama('agente-subito', { id: r.id }).catch((e) => ({ ok: false, errore: messaggioErrore(e) }))
        avvisa(esito.ok ? 'Partito: risponde tra qualche minuto'
          : esito.motivo === 'senza_pulsante' ? 'Questo agente non si può ancora far partire subito: lo fa al prossimo giro'
            : 'Non è partito subito: lo fa al prossimo giro')
      }
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  return (
    <div className="schermata agente">
      <Indietro titolo={a.nome} />
      <p className="nota-piccola">{a.cosa}. Gira {a.orari}.</p>

      <div className="scrivi-agente">
        <textarea value={testo} onChange={(e) => setTesto(e.target.value)} rows={3}
          placeholder={'Scrivi all\'agente cosa deve fare o cosa vuoi sapere…'} />
        <div className="azioni">
          <button type="button" className="tasto-grande" onClick={() => invia(true)} disabled={lavoro}>
            {lavoro ? 'Invio…' : 'Fallo adesso'}
          </button>
          <button type="button" className="tasto-link" onClick={() => invia(false)} disabled={lavoro}>Al prossimo giro</button>
        </div>
        <p className="nota-piccola">Fa solo quello che le sue regole permettono: non manda mail e non cancella niente.</p>
      </div>

      <Stato carica={carica} errore={errore}>
        {dati && (
          <>
            {dati.richieste.length > 0 && (
              <>
                <h2>Le tue richieste</h2>
                <div className="richieste">
                  {dati.richieste.map((r) => (
                    <section key={r.id} className={'richiesta' + (IN_ATTESA.includes(r.stato) ? ' in-attesa' : '')}>
                      <p className="riga-meta">{quando(r.creata_il, true)} · {STATI[r.stato]}</p>
                      <p className="richiesta-testo">{r.testo}</p>
                      {r.risposta && <p className="richiesta-risposta">{r.risposta}</p>}
                      {r.errore && IN_ATTESA.includes(r.stato) && <p className="nota-piccola rosso">{r.errore}</p>}
                      {r.sessione_url && <a className="nota-piccola" href={r.sessione_url} target="_blank" rel="noreferrer">Vedi il giro su claude.ai</a>}
                    </section>
                  ))}
                </div>
              </>
            )}
            <h2>Ultimi giri</h2>
            {dati.giri.length === 0 ? <p className="msg">Nessun giro registrato.</p> : (
              <div className="elenco">
                {dati.giri.map((g) => (
                  <div key={g.id} className="riga">
                    <span className="pallino" style={{ background: g.ok ? 'var(--verde-gc)' : 'var(--rosso, #ff6b6b)' }} />
                    <span className="riga-corpo">
                      <span className="riga-testo">{quando(g.iniziata_il, true)}</span>
                      <span className="riga-meta">{g.ok ? riepilogo(g) : g.errore}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Stato>
    </div>
  )
}
