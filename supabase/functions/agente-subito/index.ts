// "Fallo adesso" della schermata Agenti (12.10.2026): fa partire subito la routine dell'agente
// con il suo trigger API (claude.ai), invece di aspettare il giro programmato.
// La richiesta vera sta in richieste_agenti (la scrive l'app); qui si manda solo l'avviso di partire.
// Chiamata solo dall'app, con l'accesso di Giovanni. Se manca il token o la routine non parte,
// la richiesta resta "nuova" e la fa il giro programmato.
// Token: segreti ROUTINE_TOKEN_<AGENTE> (messi con scripts/salva-pulsante.mjs, mai in chat).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'

// La routine che parte per ogni agente (per G&C e Ceramex quella delle ore piene).
const ROUTINE: Record<string, string> = {
  lavoro: 'trig_012xsQNDrzFNnpAszr9gsGBh',
  ceramex: 'trig_019Tg78tNtVBbxhjWoviuSXr',
  gc: 'trig_0167WFkRzohRBwGMJKA5PQCi',
  calendario: 'trig_01ExFtoP2zGTkQDT4mnTdzGD',
  privato: 'trig_014BzqnSAWeuSq97vzQdwG15',
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const risposta = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}
const aggiorna = (id: string, campi: Record<string, unknown>) =>
  rest(`richieste_agenti?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  // Solo Giovanni.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
  const utente = u.ok ? await u.json() : null
  if (utente?.id !== UTENTE) return risposta({ errore: 'Non autorizzato' }, 401)

  const { id } = await req.json().catch(() => ({}))
  if (!id) return risposta({ errore: 'Manca la richiesta' }, 400)
  const [r] = await rest(`richieste_agenti?id=eq.${id}&select=id,agente,stato`) as { id: string; agente: string; stato: string }[]
  if (!r) return risposta({ errore: 'Richiesta non trovata' }, 404)
  if (r.stato !== 'nuova') return risposta({ ok: true, gia: r.stato })

  const routine = ROUTINE[r.agente]
  const token = Deno.env.get(`ROUTINE_TOKEN_${r.agente.toUpperCase()}`)
  if (!routine || !token) return risposta({ ok: false, motivo: 'senza_pulsante' })

  try {
    const f = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${routine}/fire`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Avvio a richiesta dall\'app: Giovanni ha scritto una richiesta nella tabella richieste_agenti. Fai solo il punto RICHIESTE DI GIOVANNI.' }),
    })
    const dati = await f.json().catch(() => ({}))
    if (!f.ok) throw new Error(dati?.error?.message || `claude.ai ${f.status}`)
    await aggiorna(id, { stato: 'avviata', avviata_il: new Date().toISOString(), sessione_url: dati.claude_code_session_url || null, errore: null })
    return risposta({ ok: true, sessione_url: dati.claude_code_session_url || null })
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    await aggiorna(id, { errore: `Non è partito subito (${errore}): lo fa il giro programmato.` })
    return risposta({ ok: false, motivo: 'non_partito', errore })
  }
})
