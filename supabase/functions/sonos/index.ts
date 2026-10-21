// Sonos nel Privato (21.10.2026, ok di Giovanni): annunci sulle casse di casa (poi sveglie).
// Integrazione "Second Brain" su developer.sonos.com (Direct Control), chiave e segreto in SONOS_KEY / SONOS_SECRET.
// I token di Sonos stanno solo in sonos_collegamento (nessun permesso all'app, agli agenti, al Capo).
// GET ?code&state                       → ritorno da Sonos dopo l'autorizzazione di Giovanni: salva i token.
// POST { azione: 'collega' }            → link per autorizzare (vale 15 minuti);
//      { azione: 'casse' }              → casse con nome, id e se fanno gli annunci;
//      { azione: 'annuncio', cassa, volume?, testo?, stile? } → dice il testo con la voce Laomedeia
//        (senza testo: il din-don di Sonos).
// Voce: Gemini 3.1 Flash TTS (chiave gratuita GEMINI_API_KEY di AI Studio, progetto "Second Brain"). Ogni frase fatta
// si salva nel bucket privato `voci` (nome = impronta di voce + stile + testo): la stessa frase non si rifà più.
// Sonos la scarica con un link firmato che vale 10 minuti.
//      { azione: 'sveglie' }            → giro di ogni minuto (pg_cron "sonos-sveglie", solo x-copia-token): suona le
//        sveglie di sonos_sveglie arrivate all'ora (saluto + meteo scherzoso + battuta, per Giovanni anche 2-3 notizie
//        di ieri cercate sul web; testo di Claude Haiku coi crediti del piano Max) e poi il Preferito Sonos;
//      { azione: 'sveglia_prova', id, cassa?, musica? } → la stessa sveglia subito, senza segnarla fatta.
// Chi può: Giovanni dall'app (non i connettori) oppure il giro programmato (x-copia-token).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { daConnettore } from '../_shared/accesso.ts'
import { VELOCE, costoDi, spesa, api, semplice } from '../_shared/ai.ts'

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
const pagina = (t: string, status = 200) =>
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

// --- Voce ---
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const MODELLO = 'gemini-3.1-flash-tts-preview'
const VOCE = 'Laomedeia'
const STILE = 'Leggi in italiano, con tono caldo, naturale e affettuoso'
const archivio = (percorso: string) => `${SUPABASE_URL}/storage/v1/${percorso}`

async function impronta(t: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Gemini dà PCM 16 bit, mono, 24 kHz: Sonos vuole MP3 o WAV, quindi si aggiunge l'intestazione WAV.
function wav(pcm: Uint8Array, hz = 24000) {
  const b = new Uint8Array(44 + pcm.length), v = new DataView(b.buffer)
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  s(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); s(8, 'WAVE'); s(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, hz, true); v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  s(36, 'data'); v.setUint32(40, pcm.length, true); b.set(pcm, 44)
  return b
}

async function firma(nome: string) {
  const r = await fetch(archivio(`object/sign/voci/${nome}`), { method: 'POST', headers: sbHeaders, body: JSON.stringify({ expiresIn: 600 }) })
  if (!r.ok) return null
  const { signedURL } = await r.json()
  return signedURL ? archivio(signedURL.replace(/^\//, '')) : null
}

// Link della frase detta da Laomedeia: quella salvata se c'è già, altrimenti la fa, la salva e la firma.
// Con `fisso` (le sveglie, testo nuovo ogni giorno) la rifà sempre e la scrive sopra la volta prima.
async function voce(testo: string, stile = STILE, fisso?: string) {
  const nome = fisso || `${await impronta(`${MODELLO}|${VOCE}|${stile}|${testo}`)}.wav`
  const gia = fisso ? null : await firma(nome)
  if (gia) return { url: gia, nuova: false, secondi: 0 }
  if (!GEMINI_API_KEY) throw new Error('Manca GEMINI_API_KEY')
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELLO}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${stile}: ${testo}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOCE } } } },
    }),
  })
  const j = await r.json().catch(() => ({}))
  const dati = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data
  if (!dati) throw new Error(`Voce non fatta (${j?.error?.message || r.status})`.slice(0, 200))
  const pcm = Uint8Array.from(atob(dati), (c) => c.charCodeAt(0))
  const su = await fetch(archivio(`object/voci/${nome}`), {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'audio/wav', 'x-upsert': 'true' },
    body: wav(pcm),
  })
  if (!su.ok) throw new Error(`Voce non salvata (${su.status})`)
  const url = await firma(nome)
  if (!url) throw new Error('Voce salvata ma senza link')
  return { url, nuova: true, secondi: pcm.length / 48000 }
}

// --- Sveglie ---
const oggiZurigo = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
const aspetta = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

// Meteo di oggi a Torricella-Taverne (Open-Meteo, gratis e senza chiave).
const CIELO: Record<number, string> = {
  0: 'sereno', 1: 'quasi sereno', 2: 'poco nuvoloso', 3: 'nuvoloso', 45: 'nebbia', 48: 'nebbia gelata',
  51: 'pioviggine leggera', 53: 'pioviggine', 55: 'pioviggine forte', 61: 'pioggia leggera', 63: 'pioggia', 65: 'pioggia forte',
  66: 'pioggia gelata', 67: 'pioggia gelata forte', 71: 'neve leggera', 73: 'neve', 75: 'neve forte', 77: 'nevischio',
  80: 'rovesci leggeri', 81: 'rovesci', 82: 'rovesci forti', 85: 'rovesci di neve', 86: 'forti rovesci di neve',
  95: 'temporale', 96: 'temporale con grandine', 99: 'temporale forte con grandine',
}
async function meteo() {
  const q = new URLSearchParams({
    latitude: '46.063', longitude: '8.930', timezone: 'Europe/Zurich', forecast_days: '1',
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  })
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`)
  if (!r.ok) throw new Error(`meteo ${r.status}`)
  const j = await r.json()
  const d = j.daily || {}, c = j.current || {}
  return `adesso ${Math.round(c.temperature_2m)} gradi e ${CIELO[c.weather_code] || 'cielo variabile'}; ` +
    `oggi ${CIELO[d.weather_code?.[0]] || 'variabile'}, minima ${Math.round(d.temperature_2m_min?.[0])}, ` +
    `massima ${Math.round(d.temperature_2m_max?.[0])} gradi, probabilità di pioggia ${d.precipitation_probability_max?.[0] ?? 0}%`
}

// Il resto del testo dopo il saluto, scritto da Claude con i crediti del piano Max (spesa in ai_uso, tetti comuni).
async function testoSveglia(sv: Record<string, any>, tempo: string) {
  const chiave = Deno.env.get('ANTHROPIC_API_KEY')
  const servizio = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const s = await spesa(servizio)
  if (!chiave || s.ciclo >= s.tetto_stop || s.oggi >= s.tetto_giorno) return null
  const data = new Date().toLocaleDateString('it-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const comune = 'Scrivi solo il testo da leggere ad alta voce, in italiano, senza titoli, elenchi, emoji, asterischi o link. ' +
    'Numeri e simboli scritti come si dicono (per esempio "dodici gradi", "più uno virgola due per cento"). ' +
    `Il saluto è già detto prima di te ("${sv.saluto}"): comincia direttamente col meteo, senza "buongiorno" né altri saluti. ` +
    `Oggi è ${data}. Meteo di Torricella-Taverne: ${tempo}.`
  const sistema = sv.per === 'bambini'
    ? `${comune} Stai svegliando dei bambini di circa 8 anni in Ticino. Racconta il meteo di oggi in modo scherzoso e affettuoso, ` +
      'con un consiglio pratico (giacca, ombrello, berretto…) e una battutina simpatica adatta ai bambini, sempre diversa. ' +
      'Chiudi invitandoli ad alzarsi con allegria. Al massimo 70 parole.'
    : `${comune} Stai svegliando Giovanni, un imprenditore ticinese. Dagli il meteo di oggi con un tocco di ironia, una battuta, ` +
      'poi 2 o 3 notizie importanti di ieri, soprattutto di borsa (SMI, borse europee e americane, franco, petrolio) o fatti di ' +
      'attualità davvero importanti: cercale sul web e usa solo fatti verificati, detti in una frase ciascuno. ' +
      'Fai PRIMA tutte le ricerche, senza scrivere niente, e solo alla fine scrivi tutto il testo in una volta. ' +
      'Chiudi con un augurio di buona giornata. Al massimo 150 parole.'
  const messaggi: Record<string, unknown>[] = [{ role: 'user', content: 'Scrivi il testo della sveglia di stamattina.' }]
  const corpo: Record<string, unknown> = { model: VELOCE, max_tokens: 3000, system: sistema, messages: messaggi }
  if (sv.notizie) corpo.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
  const blocchi: any[] = []
  // Con la ricerca sul web l'API può fermarsi a metà ("pause_turn"): si rimanda la risposta e continua.
  for (let giro = 0; giro < 3; giro++) {
    const r = await api(chiave, corpo)
    const ricerche = r.usage?.server_tool_use?.web_search_requests || 0
    await servizio.from('ai_uso').insert({ modello: VELOCE, token_in: r.usage?.input_tokens || 0, token_out: r.usage?.output_tokens || 0,
      cache_scrittura: r.usage?.cache_creation_input_tokens || 0, cache_lettura: r.usage?.cache_read_input_tokens || 0,
      costo: costoDi(VELOCE, r.usage || {}) + ricerche * 0.01 })
    blocchi.push(...(r.content || []))
    if (r.stop_reason !== 'pause_turn') break
    messaggi.push({ role: 'assistant', content: r.content })
  }
  const t = semplice(blocchi.filter((b) => b.type === 'text').map((b) => b.text).join(''))
  return t || null
}

async function vacanzaOggi() {
  const g = oggiZurigo()
  // Gli eventi "Scuola chiusa" sono dalle 6 alle 7: in UTC cadono sempre nello stesso giorno.
  const righe = await rest(`eventi?titolo=ilike.Scuola%20chiusa*&inizio=gte.${g}T00:00:00Z&inizio=lt.${g}T23:59:59Z&select=id&limit=1`) as unknown[]
  return righe.length > 0
}

// Una sveglia: testo → voce → annuncio sulla cassa → dopo la voce il Preferito Sonos a volume dolce.
async function suona(sv: Record<string, any>, prova: { cassa?: string; musica?: boolean } = {}) {
  let tempo = 'meteo non disponibile'
  try { tempo = await meteo() } catch { /* senza meteo si va avanti lo stesso */ }
  let resto: string | null = null
  try { resto = await testoSveglia(sv, tempo) } catch (e) { console.error('testo sveglia', e) }
  const frase = `${sv.saluto} ${resto || `Oggi a Torricella: ${tempo}. Buona giornata!`}`
  const stile = sv.per === 'bambini'
    ? 'Leggi in italiano con tono allegro, dolce e un po\' buffo, come chi sveglia dei bambini con un sorriso'
    : 'Leggi in italiano con tono caldo e sorridente, ritmo sciolto da radio del mattino'
  const v = await voce(frase, stile, `sveglie/${sv.id}${prova.cassa ? '-prova' : ''}.wav`)
  const token = await accesso()
  const tutte = await casse(token)
  const nomeCassa = prova.cassa || sv.cassa
  const c = tutte.find((x: any) => x.nome.toLowerCase() === nomeCassa.toLowerCase())
  if (!c) throw new Error(`Cassa non trovata: ${nomeCassa}`)
  await sonos(token, `players/${c.id}/audioClip`, {
    name: 'Second Brain', appId: 'ch.ceramex.secondbrain', priority: 'HIGH', streamUrl: v.url, volume: sv.volume_voce,
  })
  let musica = 'niente'
  if (sv.preferito && prova.musica !== false) {
    await aspetta(Math.min(170, v.secondi + 2) * 1000)
    const hh = await casa(token)
    const { items } = await sonos(token, `households/${hh}/favorites`)
    const pref = (items || []).find((f: any) => f.name.toLowerCase() === String(sv.preferito).toLowerCase())
    if (!pref) throw new Error(`Preferito Sonos non trovato: ${sv.preferito} (va aggiunto nell'app Sonos)`)
    const { groups } = await sonos(token, `households/${hh}/groups`)
    const g = (groups || []).find((x: any) => (x.playerIds || []).includes(c.id))
    if (!g) throw new Error(`Gruppo della cassa ${c.nome} non trovato`)
    await sonos(token, `groups/${g.id}/groupVolume`, { volume: sv.volume_musica })
    await sonos(token, `groups/${g.id}/favorites`, { favoriteId: pref.id, playOnCompletion: true, action: 'REPLACE', playModes: { shuffle: true } })
    musica = pref.name
  }
  return { testo: frase, secondi: Math.round(v.secondi), musica }
}

// Giro di ogni minuto: prende le sveglie da fare (una volta sola al giorno ciascuna) e le suona in sottofondo.
async function sveglie() {
  const ids = (await rest('rpc/sonos_sveglie_da_fare', { method: 'POST', body: '{}' }) as number[]) || []
  const oggi = oggiZurigo()
  for (const id of ids) {
    const prese = await rest(`sonos_sveglie?id=eq.${id}&or=(ultima_il.is.null,ultima_il.lt.${oggi})`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ultima_il: oggi, errore: null }),
    }) as Record<string, any>[]
    const sv = prese?.[0]
    if (!sv) continue
    try {
      if (sv.salta_vacanze && await vacanzaOggi()) {
        await rest(`sonos_sveglie?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_testo: 'Saltata: scuola chiusa' }) })
        continue
      }
      const fatto = await suona(sv)
      await rest(`sonos_sveglie?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_testo: fatto.testo }) })
    } catch (e) {
      const errore = String((e as Error)?.message || e).slice(0, 300)
      await rest(`sonos_sveglie?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ errore }) }).catch(() => {})
    }
  }
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
    if (!code || !stato) return pagina('Link non valido.', 400)
    const c = await leggi()
    const fresco = c.stato_oauth_il && Date.now() - new Date(c.stato_oauth_il).getTime() < 15 * 60 * 1000
    if (!c.stato_oauth || c.stato_oauth !== stato || !fresco) return pagina('Link scaduto: ricomincia il collegamento dalla Brain.', 400)
    try {
      await salva({ stato_oauth: null, stato_oauth_il: null })
      const token = await prendiToken({ grant_type: 'authorization_code', code, redirect_uri: RITORNO })
      await salva({ collegato_il: new Date().toISOString() })
      await casa(token)
      return pagina('Sonos collegato alla Brain. Puoi chiudere questa pagina.')
    } catch (e) {
      const errore = String((e as Error)?.message || e).slice(0, 300)
      await salva({ errore }).catch(() => {})
      return pagina(`Collegamento non riuscito: ${errore}`, 502)
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

  const { azione, cassa, volume, testo, stile, id, musica } = await req.json().catch(() => ({}))
  if (azione === 'sveglie') {
    if (!programmato) return risposta({ errore: 'Non autorizzato' }, 401)
    // @ts-ignore EdgeRuntime c'è nelle funzioni Supabase: il lavoro continua dopo la risposta.
    EdgeRuntime.waitUntil(sveglie().catch((e) => console.error('sveglie', e)))
    return risposta({ ok: true })
  }
  try {
    if (azione === 'sveglia_prova') {
      const [sv] = await rest(`sonos_sveglie?id=eq.${Number(id) || 0}&select=*`) as Record<string, any>[]
      if (!sv) return risposta({ errore: 'Sveglia non trovata' }, 400)
      return risposta(await suona(sv, { cassa: cassa ? String(cassa) : undefined, musica: musica !== false }))
    }
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
      const frase = String(testo || '').trim().slice(0, 500)
      const clip: Record<string, unknown> = { name: 'Second Brain', appId: 'ch.ceramex.secondbrain', priority: 'HIGH' }
      let nuova = false
      if (frase) {
        const v = await voce(frase, stile ? String(stile).slice(0, 200) : undefined)
        clip.streamUrl = v.url
        nuova = v.nuova
      } else clip.clipType = 'CHIME'
      if (volume != null) clip.volume = Math.max(5, Math.min(80, Number(volume) || 30))
      const r = await sonos(token, `players/${scelta.id}/audioClip`, clip)
      return risposta({ ok: true, cassa: scelta.nome, clip: r?.id, voce_nuova: nuova })
    }
    return risposta({ errore: 'Azione sconosciuta' }, 400)
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    await salva({ errore }).catch(() => {})
    return risposta({ errore }, 502)
  }
})
