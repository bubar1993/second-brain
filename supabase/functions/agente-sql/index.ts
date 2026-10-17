// Porta del database per gli agenti (routine Claude in cloud).
// Esegue l'SQL ricevuto con l'utente del database legato al token:
// - AGENTE_TOKEN → "agente_gc": vede e scrive SOLO l'area G (mail G&C);
// - AGENTE_TOKEN_LAVORO → "agente_lavoro": note Ceramex e G&C + smistamento dell'Inbox;
// - AGENTE_TOKEN_PRIVATO → "agente_privato": solo il Privato;
// - AGENTE_TOKEN_CALENDARIO → "agente_calendario": solo gli appuntamenti (e i nomi di ditte e persone);
// - AGENTE_TOKEN_CERAMEX → "agente_ceramex": solo l'area C (note clienti delle routine Bozze mail Ceramex);
// - AGENTE_TOKEN_SMISTATORE → "agente_smistatore": legge domande e richieste di lavoro, scrive richieste agli agenti.
// - AGENTE_TOKEN_SEGUIRE → "agente_seguire": promesse, campioni, circolari e doppioni di C e G.
// - AGENTE_TOKEN_CAPO → "agente_capo": Agente capo, legge e scrive tutto (C, G, P) tranne wa_collegamento, niente delete.
// Cosa vede e scrive ognuno lo garantiscono i permessi del database (niente cancellazioni di note).
// Uso: POST con header x-agente-token e l'SQL nel corpo (testo semplice o JSON {"sql": "..."}).
import postgres from 'npm:postgres@3.4.5'

const PORTE = ['', '_LAVORO', '_PRIVATO', '_CALENDARIO', '_CERAMEX', '_SMISTATORE', '_SEGUIRE', '_CAPO']
  .map((s) => ({ token: Deno.env.get(`AGENTE_TOKEN${s}`), url: Deno.env.get(`AGENTE_DB_URL${s}`) }))
  .filter((p) => p.token && p.url)
const MASSIMO = 300000 // caratteri di risposta
// Niente chiamate a internet dal database (pg_net, 18.10.2026, ok di Giovanni): il permesso lo dà Supabase a tutti e
// non si può togliere, quindi si fermano qui le istruzioni che le usano e i modi per costruirle "a pezzi"
// (blocchi DO, funzioni plpgsql temporanee, query_to_xml/ts_stat/ts_rewrite, nomi scritti con U&"…").
// Nessun agente le usa sul second brain (l'archiviazione G&C le usa sul gestionale G&C, con il suo connettore).
const VIETATO = /http_(post|get|delete|request|collect)|_http_response|\bnet\s*\.|"net"|\bU&\s*["']|(^|[;\n]|\*\/)\s*do\s*(\$|'|e'|language\b)|plpgsql|\bcreate\s+(or\s+replace\s+)?(function|procedure)\b|pg_temp|query_to_xml|cursor_to_xml|\bts_stat\b|\bts_rewrite\b/i

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Usa POST', { status: 405 })
  const dato = req.headers.get('x-agente-token')
  const porta = dato ? PORTE.find((p) => p.token === dato) : undefined
  if (!porta) return new Response('Non autorizzato', { status: 401 })
  const corpo = await req.text()
  let query = corpo
  if ((req.headers.get('content-type') || '').includes('json')) {
    try { query = JSON.parse(corpo).sql } catch { return new Response('JSON non valido', { status: 400 }) }
  }
  if (!query?.trim()) return new Response('SQL vuoto', { status: 400 })
  if (VIETATO.test(query)) {
    return new Response(JSON.stringify({ errore: 'Non permesso agli agenti: chiamate a internet dal database e blocchi DO/funzioni.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  const sql = postgres(porta.url!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5 })
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
