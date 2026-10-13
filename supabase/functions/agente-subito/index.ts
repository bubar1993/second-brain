// "Fallo adesso" della schermata Agenti (12.10.2026): fa partire subito la routine dell'agente
// con il suo trigger API (claude.ai), invece di aspettare il giro programmato.
// La richiesta vera sta in richieste_agenti; qui si manda solo l'avviso di partire.
// Chi può chiamarla:
// - l'app, con l'accesso di Giovanni: { id } (una sua richiesta) oppure { sveglia: 'smistatore' } (ha appena risposto
//   a una domanda: lo smistatore guarda subito se va passata a un altro agente; al massimo una volta ogni 3 minuti)
//   oppure { sveglia: 'capo' } (ha confermato o rifiutato una cosa del capo);
// - lo smistatore (header x-agente-token = AGENTE_TOKEN_SMISTATORE): { id } solo per le richieste scritte da lui;
// - il capo (x-agente-token = AGENTE_TOKEN_CAPO, 13.10.2026): { id } solo per le richieste scritte da lui, anche al privato;
// - l'agente Ceramex (x-agente-token = AGENTE_TOKEN_CERAMEX, 13.10.2026 sera): { id } solo per le sue segnalazioni
//   di mail private al capo (agente = 'capo', da = 'ceramex').
// Se manca il token della routine o non parte, la richiesta resta "nuova" e la fa il giro programmato.
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
  archiviazione: 'trig_01Go1LUFLhtADpTeZs2GjY8s',
  smistatore: 'trig_01EmGQxMLKmQgRjYHJw77p9L',
  seguire: 'trig_01DznF5caV1wjdxjt2bH1w2a',
  capo: 'trig_01Hv5Y9LHytXiiX5L3xs2Nuw',
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

async function parti(agente: string, testo: string) {
  const routine = ROUTINE[agente]
  const token = Deno.env.get(`ROUTINE_TOKEN_${agente.toUpperCase()}`)
  if (!routine || !token) return { ok: false, motivo: 'senza_pulsante' }
  // Il capo non ha il token del database nel prompt: glielo passa il messaggio di avvio (resta solo nei segreti).
  if (agente === 'capo') {
    const porta = Deno.env.get('AGENTE_TOKEN_CAPO')
    if (!porta) return { ok: false, motivo: 'senza_pulsante' }
    testo += `\n\nToken della porta: ${porta}`
  }
  const f = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${routine}/fire`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: testo }),
  })
  const dati = await f.json().catch(() => ({}))
  if (!f.ok) throw new Error(dati?.error?.message || `claude.ai ${f.status}`)
  return { ok: true, sessione_url: dati.claude_code_session_url || null }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  // Chi chiama: lo smistatore, il capo o l'agente Ceramex (col loro token) oppure Giovanni (accesso dell'app).
  const tokenAgente = req.headers.get('x-agente-token')
  const tokenSmistatore = Deno.env.get('AGENTE_TOKEN_SMISTATORE')
  const tokenCapo = Deno.env.get('AGENTE_TOKEN_CAPO')
  const tokenCeramex = Deno.env.get('AGENTE_TOKEN_CERAMEX')
  let chi: 'giovanni' | 'smistatore' | 'capo' | 'ceramex'
  if (tokenAgente) {
    if (tokenSmistatore && tokenAgente === tokenSmistatore) chi = 'smistatore'
    else if (tokenCapo && tokenAgente === tokenCapo) chi = 'capo'
    else if (tokenCeramex && tokenAgente === tokenCeramex) chi = 'ceramex'
    else return risposta({ errore: 'Non autorizzato' }, 401)
  } else {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
    const utente = u.ok ? await u.json() : null
    if (utente?.id !== UTENTE) return risposta({ errore: 'Non autorizzato' }, 401)
    chi = 'giovanni'
  }

  const { id, sveglia } = await req.json().catch(() => ({}))

  // Giovanni ha appena risposto a una domanda: sveglia lo smistatore (non più di una volta ogni 3 minuti).
  if (sveglia === 'smistatore' && chi === 'giovanni') {
    const [s] = await rest('sveglie?agente=eq.smistatore&select=ultima') as { ultima: string }[]
    if (s && Date.now() - new Date(s.ultima).getTime() < 180000) return risposta({ ok: true, gia: 'partito da poco' })
    try {
      const esito = await parti('smistatore', 'Avvio a richiesta dall\'app: Giovanni ha appena risposto a una domanda degli agenti. Guarda se va passata a un altro agente.')
      if (esito.ok) {
        await rest('sveglie?on_conflict=agente', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ agente: 'smistatore', ultima: new Date().toISOString() }) })
      }
      return risposta(esito)
    } catch (e) {
      return risposta({ ok: false, motivo: 'non_partito', errore: String((e as Error)?.message || e).slice(0, 300) })
    }
  }

  // Giovanni ha confermato o rifiutato una cosa del capo: sveglia il capo (non più di una volta ogni 20 secondi;
  // se ne conferma altre subito dopo, le trova lo stesso giro o il successivo).
  if (sveglia === 'capo' && chi === 'giovanni') {
    const [s] = await rest('sveglie?agente=eq.capo&select=ultima') as { ultima: string }[]
    if (s && Date.now() - new Date(s.ultima).getTime() < 20000) return risposta({ ok: true, gia: 'partito da poco' })
    try {
      const esito = await parti('capo', 'Avvio a richiesta dall\'app: Giovanni ha appena confermato o rifiutato una cosa in capo_conferme. Fai il giro come sempre.')
      if (esito.ok) {
        await rest('sveglie?on_conflict=agente', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ agente: 'capo', ultima: new Date().toISOString() }) })
      }
      return risposta(esito)
    } catch (e) {
      return risposta({ ok: false, motivo: 'non_partito', errore: String((e as Error)?.message || e).slice(0, 300) })
    }
  }

  if (!id) return risposta({ errore: 'Manca la richiesta' }, 400)
  const [r] = await rest(`richieste_agenti?id=eq.${id}&select=id,agente,stato,da`) as { id: string; agente: string; stato: string; da: string }[]
  if (!r) return risposta({ errore: 'Richiesta non trovata' }, 404)
  // Lo smistatore fa partire solo le richieste scritte da lui, e mai l'agente privato; il capo solo le sue (anche al privato).
  if (chi === 'smistatore' && (r.da !== 'smistatore' || r.agente === 'privato')) return risposta({ errore: 'Non autorizzato' }, 403)
  if (chi === 'capo' && (r.da !== 'capo' || r.agente === 'capo')) return risposta({ errore: 'Non autorizzato' }, 403)
  if (chi === 'ceramex' && (r.da !== 'ceramex' || r.agente !== 'capo')) return risposta({ errore: 'Non autorizzato' }, 403)
  if (r.stato !== 'nuova') return risposta({ ok: true, gia: r.stato })

  try {
    const testo = r.agente === 'capo' && r.da === 'ceramex'
      ? 'Avvio a richiesta dell\'agente Ceramex: ti segnala una o più mail private arrivate nella Gmail (richiesta con da = \'ceramex\', vedi MAIL PRIVATE). Fai il giro come sempre.'
      : r.agente === 'capo'
      ? 'Avvio a richiesta dall\'app: Giovanni ti ha scritto (o ha appena confermato o rifiutato una cosa). Fai il giro come sempre.'
      : r.da === 'smistatore'
      ? 'Avvio a richiesta dello smistatore: c\'è una richiesta per te nella tabella richieste_agenti (passata dallo smistatore). Fai solo il punto RICHIESTE DI GIOVANNI.'
      : r.da === 'capo'
      ? 'Avvio a richiesta dell\'agente capo: c\'è una richiesta per te nella tabella richieste_agenti (passata dal capo per conto di Giovanni). Fai solo il punto RICHIESTE DI GIOVANNI.'
      : 'Avvio a richiesta dall\'app: Giovanni ha scritto una richiesta nella tabella richieste_agenti. Fai solo il punto RICHIESTE DI GIOVANNI.'
    const esito = await parti(r.agente, testo)
    if (!esito.ok) return risposta(esito)
    await aggiorna(id, { stato: 'avviata', avviata_il: new Date().toISOString(), sessione_url: esito.sessione_url, errore: null })
    return risposta(esito)
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    await aggiorna(id, { errore: `Non è partito subito (${errore}): lo fa il giro programmato.` })
    return risposta({ ok: false, motivo: 'non_partito', errore })
  }
})
