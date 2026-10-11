// Porta del database per l'agente G&C (routine Claude in cloud).
// Esegue l'SQL ricevuto come utente "agente_gc": vede e scrive SOLO l'area G
// (niente Privato, niente Ceramex, niente cancellazioni: lo garantiscono i permessi del database).
// Uso: POST con header x-agente-token e l'SQL nel corpo (testo semplice o JSON {"sql": "..."}).
import postgres from 'npm:postgres@3.4.5'

const AGENTE_TOKEN = Deno.env.get('AGENTE_TOKEN')
const AGENTE_DB_URL = Deno.env.get('AGENTE_DB_URL')
const MASSIMO = 300000 // caratteri di risposta

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Usa POST', { status: 405 })
  if (!AGENTE_TOKEN || req.headers.get('x-agente-token') !== AGENTE_TOKEN) {
    return new Response('Non autorizzato', { status: 401 })
  }
  const corpo = await req.text()
  let query = corpo
  if ((req.headers.get('content-type') || '').includes('json')) {
    try { query = JSON.parse(corpo).sql } catch { return new Response('JSON non valido', { status: 400 }) }
  }
  if (!query?.trim()) return new Response('SQL vuoto', { status: 400 })

  const sql = postgres(AGENTE_DB_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5 })
  try {
    const res = await sql.unsafe(query)
    let testo = JSON.stringify(res)
    if (testo.length > MASSIMO) testo = testo.slice(0, MASSIMO) + '… [TAGLIATO: usa limit o meno colonne]'
    return new Response(testo, { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ errore: String((e as Error)?.message || e) }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  } finally {
    sql.end({ timeout: 2 }).catch(() => {})
  }
})
