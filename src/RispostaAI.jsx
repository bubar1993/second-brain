import { useEffect } from 'react'
import { sb, quando } from './supabase'

// Risposta scritta dall'AI: la usano Chiedi e "Prima della visita" in Oggi (file a parte dal 22.10.2026, così Oggi
// non si porta dietro tutto Chiedi all'apertura dell'app).

const TIPI_FONTE = { nota: 'Nota', mail: 'Mail', persona: 'Persona', whatsapp: 'WhatsApp', azienda: 'Scheda', appuntamento: 'Appuntamento', promemoria: 'Promemoria' }

// Risposta scritta dall'AI (14.10.2026, crediti API del piano Max): testo semplice, i numeri [n] diventano
// link alle fonti (i link li costruisce il server, mai il modello).
export function RispostaAI({ ai }) {
  const fonte = (n) => ai.fonti?.find((f) => f.n === n)
  const parti = (ai.testo || '').split(/(\[\d+(?:\s*,\s*\d+)*\])/)
  return (
    <section className="risposta-ai" aria-live="polite">
      {ai.stato === 'in_corso' && <p className="risposta-attesa">Ci penso… di solito bastano 10–30 secondi.</p>}
      {ai.stato === 'errore' && <p className="msg">{ai.testo}</p>}
      {ai.stato === 'fatta' && (
        <>
          <p className="risposta-testo">
            {parti.map((p, i) => {
              const m = p.match(/^\[(.+)\]$/)
              if (!m) return p
              return m[1].split(',').map((x) => Number(x.trim())).map((n) => fonte(n)
                ? <a key={i + '-' + n} className="cita" href={fonte(n).link} aria-label={`Fonte ${n}`}>{n}</a> : null)
            })}
          </p>
          {ai.fonti?.length > 0 && (
            <div className="elenco fonti-ai">
              {ai.fonti.map((f) => (
                <a key={f.n} className="riga riga-trovato" href={f.link}>
                  <span className="cita fermo">{f.n}</span>
                  <span className="riga-corpo">
                    <span className="riga-meta">{TIPI_FONTE[f.tipo] || f.tipo} · {f.titolo}{f.data ? ` · ${quando(f.data)}` : ''}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
          <p className="nota-piccola">
            {ai.nota ? ai.nota + ' ' : ''}Risposta dell'AI da quello che c'è qui: guarda le fonti. Per fare qualcosa, scrivilo al Capo.
          </p>
        </>
      )}
    </section>
  )
}

// La risposta la scrive la funzione in sottofondo: qui la si rilegge finché è pronta (anche tornando nell'app).
export function useAttesaAI(ai, setAi) {
  useEffect(() => {
    if (!ai?.id || ai.stato !== 'in_corso') return
    let via = false
    const t = setInterval(async () => {
      const { data } = await sb.from('ai_risposte').select('id,stato,testo,fonti,nota,creata_il').eq('id', ai.id).maybeSingle()
      if (via || !data) return
      if (data.stato !== 'in_corso') setAi(data)
      else if (Date.now() - new Date(data.creata_il).getTime() > 180_000) setAi({ ...data, stato: 'errore', testo: 'Non sono riuscito a rispondere. Riprova.' })
    }, 1500)
    return () => { via = true; clearInterval(t) }
  }, [ai?.id, ai?.stato])
}
