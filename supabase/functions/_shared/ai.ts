// Chiamate all'API Anthropic con i crediti del piano Max (14.10.2026): prezzi, spesa del mese e tetti.
// Le usano chiedi-ai (Chiedi) e capo-veloce (risposta veloce del Capo, 16.10.2026): la spesa sta tutta in ai_uso,
// così i tetti di ai_impostazioni valgono per tutte e due insieme.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const ATTENTO = 'claude-sonnet-5-5'
export const VELOCE = 'claude-haiku-5-5'
// Dollari per milione di token (pagina prezzi ufficiale, 14.10.2026): ingresso, uscita, cache scritta (5 min), cache letta.
const PREZZI: Record<string, { i: number; o: number; cw: number; cr: number }> = {
  [ATTENTO]: { i: 2, o: 10, cw: 2.5, cr: 0.10 },
  [VELOCE]: { i: 0.10, o: 0.50, cw: 0.125, cr: 0.01 },
}

type Riga = Record<string, any>

// Costo di una chiamata dai token che l'API restituisce (cache comprese).
export function costoDi(modello: string, u: Riga) {
  const p = PREZZI[modello] || PREZZI[ATTENTO]
  return ((u.input_tokens || 0) * p.i + (u.output_tokens || 0) * p.o +
    (u.cache_creation_input_tokens || 0) * p.cw + (u.cache_read_input_tokens || 0) * p.cr) / 1e6
}

// Inizio del ciclo dei crediti: il giorno "inizio_ciclo" di questo mese (o del mese prima), a mezzanotte a Zurigo.
function inizioCiclo(giornoCiclo: number) {
  const [a, m, g] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }).split('-').map(Number)
  const d = g >= giornoCiclo ? new Date(Date.UTC(a, m - 1, giornoCiclo)) : new Date(Date.UTC(a, m - 2, giornoCiclo))
  return new Date(d.getTime() - 2 * 3600e3).toISOString() // circa mezzanotte svizzera (2 ore di margine)
}
const inizioGiorno = () => {
  const [a, m, g] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }).split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, g) - 2 * 3600e3).toISOString()
}

export async function spesa(servizio: SupabaseClient) {
  const { data: imp } = await servizio.from('ai_impostazioni').select('*').eq('id', 1).single()
  const i = imp || { inizio_ciclo: 1, tetto_veloce: 70, tetto_stop: 90, tetto_giorno: 15 }
  const [{ data: ciclo }, { data: oggi }] = await Promise.all([
    servizio.rpc('ai_spesa', { da: inizioCiclo(i.inizio_ciclo) }),
    servizio.rpc('ai_spesa', { da: inizioGiorno() }),
  ])
  return { ciclo: Number(ciclo || 0), oggi: Number(oggi || 0), ...i }
}

export async function api(chiave: string, corpo: Riga) {
  for (let tentativo = 0; ; tentativo++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chiave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    if (r.ok) return await r.json()
    const testo = await r.text()
    if ([429, 500, 529].includes(r.status) && tentativo === 0) { await new Promise((ok) => setTimeout(ok, 3000)); continue }
    if (/credit balance/i.test(testo)) throw new Error('Crediti AI del mese finiti: le risposte tornano col prossimo mese.')
    if (r.status === 401) throw new Error('La chiave AI non funziona più: va rifatta (dillo a Claude sul PC).')
    if (r.status === 429 || r.status === 529) throw new Error('L\'AI è molto occupata adesso: riprova tra un minuto.')
    throw new Error(`AI: errore ${r.status} ${testo.slice(0, 200)}`)
  }
}

// Testo semplice: via link, immagini, titoli e grassetti (i link li mette solo l'app, dalle fonti).
export function semplice(t: string) {
  return t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\((?:https?:|mailto:|#)[^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim()
}
