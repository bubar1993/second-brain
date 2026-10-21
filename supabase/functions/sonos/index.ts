// Sonos nel Privato (21.10.2026, ok di Giovanni): annunci sulle casse di casa (poi sveglie).
// Integrazione "Second Brain" su developer.sonos.com (Direct Control), chiave e segreto in SONOS_KEY / SONOS_SECRET.
// I token di Sonos stanno solo in sonos_collegamento (nessun permesso all'app, agli agenti, al Capo).
// GET ?code&state                       → ritorno da Sonos dopo l'autorizzazione di Giovanni: salva i token.
// POST { azione: 'collega' }            → link per autorizzare (vale 15 minuti);
//      { azione: 'casse' }              → casse con nome, id e se fanno gli annunci;
//      { azione: 'annuncio', cassa, volume?, url? } → suona un annuncio (senza url: il din-don di Sonos).
// Chi può: Giovanni dall'app (non i connettori) oppure il giro programmato (x-copia-token).

import { daConnettore } from '../_shared/accesso.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const SONOS_KEY = Deno.env.get('SONOS_KEY')
const SONOS_SECRET = Deno.env.get('SONOS_SECRET')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const RITORNO = `${SUPABASE_URL}/functions/v1/sonos`
const LOGIN = 'https://api.sonos.com/login/v3/oauth'
const CONTROLLO = 'https://api.ws.sonos.com/control/api/v1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const risposta = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const testo = (t: string, status = 200) =>
  new Response(t, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}
const leggi = async () => ((await rest('sonos_collegamento?id=eq.1&select=*')) as Record<string, any>[])[0] || {}
const salva = (campi: Record<string, unknown>) =>
  rest('sonos_collegamento?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })

// Scambio con Sonos: codice dell'autorizzazione o refresh token → token nuovi, salvati.
async function prendiToken(corpo: Record<string, string>) {
  const r = await fetch(`${LOGIN}/access`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${SONOS_KEY}:${SONOS_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(corpo),
  })
  const t = await r.json().catch(() => ({}))
  if (!t.access_token) throw new Error(`Sonos non dà il token (${t.error_description || t.error || r.status})`)
  const campi: Record<string, unknown> = {
    access_token: t.access_token,
    scade_il: new Date(Date.now() + (Number(t.expires_in) || 86400) * 1000 - 5 * 60 * 1000).toISOString(),
    errore: null,
  }
  if (t.refresh_token) campi.refresh_token = t.refresh_token
  await salva(campi)
  return t.access_token as string
}

async function accesso() {
  const c = await leggi()
  if (!c.refresh_token) throw new Error('Sonos non ancora collegato')
  if (c.access_token && c.scade_il && new Date(c.scade_il) > new Date()) return c.access_token as string
  return prendiToken({ grant_type: 'refresh_token', refresh_token: c.refresh_token })
}

async function sonos(token: string, percorso: string, corpo?: unknown) {
  const r = await fetch(`${CONTROLLO}/${percorso}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Sonos ${percorso.split('/').slice(-1)[0]}: ${j?.errorCode || j?.reason || r.status}`)
  return j
}

async function casa(token: string) {
  const c = await leggi()
  if (c.household_id) return c.household_id as string
  const { households } = await sonos(token, 'households')
  const id = households?.[0]?.id
  if (!id) throw new Error('Nessuna casa Sonos trovata')
  await salva({ household_id: id })
  return id as string
}

async function casse(token: string) {
  const { players } = await sonos(token, `households/${await casa(token)}/groups`)
  return (players || []).map((p: any) => ({
    id: p.id, nome: p.name, annunci: (p.capabilities || []).includes('AUDIO_CLIP'),
  }))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!SONOS_KEY || !SONOS_SECRET) return risposta({ errore: 'Mancano SONOS_KEY / SONOS_SECRET' }, 500)

  // Ritorno da Sonos (il browser di Giovanni, dopo che ha detto sì a Sonos).
  if (req.method === 'GET') {
    const u = new URL(req.url)
    const code = u.searchParams.get('code'), stato = u.searchParams.get('state')
    if (!code || !stato) return testo('Link non valido.', 400)
    const c = await leggi()
    const fresco = c.stato_oauth_il && Date.now() - new Date(c.stato_oauth_il).getTime() < 15 * 60 * 1000
    if (!c.stato_oauth || c.stato_oauth !== stato || !fresco) return testo('Link scaduto: ricomincia il collegamento dalla Brain.', 400)
    try {
      await salva({ stato_oauth: null, stato_oauth_il: null })
      const token = await prendiToken({ grant_type: 'authorization_code', code, redirect_uri: RITORNO })
      await salva({ collegato_il: new Date().toISOString() })
      await casa(token)
      return testo('Sonos collegato alla Brain. Puoi chiudere questa pagina.')
    } catch (e) {
      const errore = String((e as Error)?.message || e).slice(0, 300)
      await salva({ errore }).catch(() => {})
      return testo(`Collegamento non riuscito: ${errore}`, 502)
    }
  }
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  const programmato = !!COPIA_TOKEN && req.headers.get('x-copia-token') === COPIA_TOKEN
  if (!programmato) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
    const utente = u.ok ? await u.json() : null
    if (utente?.id !== UTENTE || daConnettore(jwt)) return risposta({ errore: 'Non autorizzato' }, 401)
  }

  const { azione, cassa, volume, url } = await req.json().catch(() => ({}))
  try {
    if (azione === 'collega') {
      const stato = crypto.randomUUID()
      await salva({ stato_oauth: stato, stato_oauth_il: new Date().toISOString() })
      const q = new URLSearchParams({ client_id: SONOS_KEY, response_type: 'code', state: stato, scope: 'playback-control-all', redirect_uri: RITORNO })
      return risposta({ link: `${LOGIN}?${q}` })
    }
    const token = await accesso()
    if (azione === 'casse') return risposta({ casse: await casse(token) })
    if (azione === 'annuncio') {
      const tutte = await casse(token)
      const scelta = tutte.find((c: any) => c.id === cassa || c.nome.toLowerCase() === String(cassa || '').toLowerCase())
      if (!scelta) return risposta({ errore: `Cassa non trovata: ${cassa}`, casse: tutte.map((c: any) => c.nome) }, 400)
      if (!scelta.annunci) return risposta({ errore: `${scelta.nome} non fa gli annunci` }, 400)
      if (url && !/^https:\/\//.test(url)) return risposta({ errore: 'url deve essere https' }, 400)
      const clip: Record<string, unknown> = { name: 'Second Brain', appId: 'ch.ceramex.secondbrain', priority: 'HIGH' }
      if (url) clip.streamUrl = url
      else clip.clipType = 'CHIME'
      if (volume != null) clip.volume = Math.max(5, Math.min(80, Number(volume) || 30))
      const r = await sonos(token, `players/${scelta.id}/audioClip`, clip)
      return risposta({ ok: true, cassa: scelta.nome, clip: r?.id })
    }
    return risposta({ errore: 'Azione sconosciuta' }, 400)
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    await salva({ errore }).catch(() => {})
    return risposta({ errore }, 502)
  }
})
