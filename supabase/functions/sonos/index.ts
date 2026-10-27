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
//      { azione: 'sveglia_prova', id, cassa?, musica? } → la stessa sveglia subito, senza segnarla fatta;
//      { azione: 'sveglie_elenco' (completo?) | 'sveglia_cambia' (ora?, attiva?, volume_voce?, volume_musica?) | 'senza_alessia' | 'sveglia_nuova' | 'sveglia_togli' }
//        → pagina Sveglie dell'app (la nuova sveglia sceglie una delle FRASI standard);
//      { azione: 'messaggio_nuovo', data, ora, casse[], testo, volume? } | { azione: 'messaggio_togli', id }
//        → messaggi a un'ora precisa (sonos_messaggi), detti dal giro 'sveglie';
//      { azione: 'esegui_conferma', id } → solo Giovanni: fa una conferma 'sonos' del Capo dopo i due tocchi.
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

// Laomedeia dice (o canta) il testo: PCM 16 bit, mono, 24 kHz.
// Quota gratuita: 10 voci al giorno e 3 al minuto PER MODELLO (AI Studio, 21.10.2026). Finita quella del primo
// modello si passa al successivo, con la stessa voce Laomedeia.
const MODELLI_VOCE = [MODELLO, 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts']
async function parla(testo: string, stile: string) {
  let motivo = ''
  for (const modello of MODELLI_VOCE) {
    try { return await parlaCon(modello, testo, stile) } catch (e) { motivo = String((e as Error)?.message || e) }
  }
  throw new Error(motivo)
}

// Indicazioni di regia e testo separati, come nella guida di Google: con stile: testo alcuni modelli
// leggevano ad alta voce anche le indicazioni (21.10.2026). v2 nelle impronte = voci rifatte con questo formato.
const copione = (testo: string, stile: string) =>
  `### DIRECTOR'S NOTES (non leggere)\n${stile}.\n\n### TRANSCRIPT (leggi solo questo)\n${testo}`

// A volte Gemini risponde senza audio: si riprova fino a 3 volte.
async function parlaCon(modello: string, testo: string, stile: string) {
  if (!GEMINI_API_KEY) throw new Error('Manca GEMINI_API_KEY')
  let motivo = ''
  for (let tentativo = 0; tentativo < 3; tentativo++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: copione(testo, stile) }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOCE } } } },
      }),
    })
    const j = await r.json().catch(() => ({}))
    const dati = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data
    if (dati) return Uint8Array.from(atob(dati), (c) => c.charCodeAt(0))
    motivo = j?.error?.message || j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason || String(r.status)
    if (r.status === 400 || r.status === 403) break
    // Quota gratuita: al giorno → subito il modello dopo; al minuto → si aspetta e si riprova una volta.
    if (r.status === 429) {
      if (tentativo > 0 || /PerDay/i.test(JSON.stringify(j?.error?.details || []))) break
      await new Promise((ok) => setTimeout(ok, 30000))
    }
  }
  throw new Error(`Voce non fatta con ${modello} (${motivo})`.slice(0, 200))
}

// Salva il PCM come WAV nel bucket `voci` (sopra quello di prima) e dà il link firmato.
async function salvaVoce(nome: string, pcm: Uint8Array) {
  const su = await fetch(archivio(`object/voci/${nome}`), {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'audio/wav', 'x-upsert': 'true' },
    body: wav(pcm),
  })
  if (!su.ok) throw new Error(`Voce non salvata (${su.status})`)
  const url = await firma(nome)
  if (!url) throw new Error('Voce salvata ma senza link')
  return url
}

// PCM di un WAV già salvato (senza i 44 byte dell'intestazione), o null se non c'è.
async function leggiVoce(nome: string) {
  const r = await fetch(archivio(`object/authenticated/voci/${nome}`), { headers: sbHeaders })
  return r.ok ? new Uint8Array(await r.arrayBuffer()).slice(44) : null
}

// Link della frase detta da Laomedeia: quella salvata se c'è già, altrimenti la fa, la salva e la firma.
async function voce(testo: string, stile = STILE) {
  const nome = `${await impronta(`v2|${MODELLO}|${VOCE}|${stile}|${testo}`)}.wav`
  const gia = await firma(nome)
  if (gia) return { url: gia, nuova: false }
  const pcm = unisci(silenzio(0.4), sfuma(await parla(testo, stile)), silenzio(0.6))
  return { url: await salvaVoce(nome, pcm), nuova: true }
}

const unisci = (...pezzi: Uint8Array[]) => {
  const tutto = new Uint8Array(pezzi.reduce((n, p) => n + p.length, 0))
  pezzi.reduce((da, p) => (tutto.set(p, da), da + p.length), 0)
  return tutto
}
const silenzio = (secondi: number) => new Uint8Array(Math.round(secondi * 24000) * 2)

// Dissolvenza di 60 ms all'inizio e alla fine: senza, Sonos fa un "bzz" quando il suono parte o finisce di colpo.
function sfuma(pcm: Uint8Array) {
  const fuori = pcm.slice(0, pcm.length - (pcm.length % 2))
  const v = new DataView(fuori.buffer)
  const n = fuori.length / 2, f = Math.min(1440, Math.floor(n / 2))
  for (let i = 0; i < f; i++) {
    const k = i / f
    v.setInt16(i * 2, Math.round(v.getInt16(i * 2, true) * k), true)
    v.setInt16((n - 1 - i) * 2, Math.round(v.getInt16((n - 1 - i) * 2, true) * k), true)
  }
  return fuori
}

// Canzoncine della sveglia dei bambini (scritte apposta, ~10 secondi, una al giorno a giro), cantate e salvate.
const CANZONI = [
  'Din don, din don, il sole fa capolino, apri gli occhietti, è già mattino!',
  'Cucù, cucù, il gallo canta già, la notte se n\'è andata e il giorno arriva qua!',
  'Tic tac, tic tac, fa l\'orologio sul comò, svegliatevi bambini, io vi canto un po\'!',
  'Lalalà, lalalà, la luna è andata a letto, e adesso tocca al sole entrare dal tetto!',
  'Brr brr brr, chi si nasconde nel piumone? Su su su, c\'è il sole sul balcone!',
  'Pim pum pam, chi dorme ancora qua? Un raggio di sole vi fa il solletico già!',
  'Uccellini sul ramo cantano con me, cip cip cip, che bel giorno che c\'è!',
  'Dormi dormi? No no no! Sveglia sveglia? Sì sì sì! Oggi è proprio un bellissimo dì!',
]
const STILE_CANTO = 'Canta piano questa canzoncina con una melodia semplice, dolce e allegra, a voce morbida, come per svegliare con delicatezza dei bambini'
// Solo il modello principale canta bene: i modelli di riserva leggevano ad alta voce le indicazioni (21.10.2026).
// Se oggi non si può fare quella del giorno, va una delle altre già salvate; se non ce n'è nessuna, niente canzoncina.
async function canzone(numero?: number) {
  const giorno = numero ?? Math.floor(Date.now() / 86400e3)
  const nomeDi = async (t: string) => `canzoni/${await impronta(`v3|${MODELLO}|${VOCE}|${STILE_CANTO}|${t}`)}.wav`
  const testo = CANZONI[giorno % CANZONI.length]
  const nome = await nomeDi(testo)
  const gia = await leggiVoce(nome)
  if (gia) return gia
  try {
    const pcm = await parlaCon(MODELLO, testo, STILE_CANTO)
    await salvaVoce(nome, pcm)
    return pcm
  } catch (e) {
    for (let i = 1; i < CANZONI.length; i++) {
      const altra = await leggiVoce(await nomeDi(CANZONI[(giorno + i) % CANZONI.length]))
      if (altra) return altra
    }
    throw e
  }
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

// Un tema al giorno per l'indovinello dei bimbi: senza, Claude ripeteva sempre lo stesso.
const TEMI = ['animali della fattoria', 'dinosauri', 'la scuola', 'frutta e verdura', 'il calcio', 'il pianoforte', 'il mare',
  'lo spazio e i pianeti', 'la ginnastica', 'i colori', 'la colazione', 'gli insetti', 'i mezzi di trasporto', 'la neve',
  'gli animali della giungla', 'i numeri', 'le stagioni', 'i vestiti', 'il tennis', 'i pesci']

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
      'con un consiglio pratico (giacca, ombrello, berretto…) e una battutina che faccia davvero ridere un bambino di 8 anni: ' +
      'un indovinello o un gioco di parole semplice e sensato con la risposta, sempre diverso. ' +
      `Oggi l'indovinello parla di: ${TEMI[Math.floor(Date.now() / 86400e3) % TEMI.length]} (niente nuvole né pioggia). ` +
      'Chiudi invitandoli ad alzarsi con allegria. Al massimo 70 parole.'
    : `${comune} Stai svegliando Giovanni, un imprenditore ticinese. Dagli il meteo di oggi con un tocco di ironia, una battuta, ` +
      'poi 1 o 2 fatti di ieri che hanno davvero mosso la borsa o l\'economia (NON un elenco di indici: cosa è successo e perché ' +
      'conta, al massimo un numero), poi l\'highlight di ieri nel mondo AI e tech: nuovi modelli, nuove uscite, presentazioni ' +
      'importanti (1 o 2 notizie). Cerca tutto sul web e usa solo fatti verificati di ieri o di stanotte. ' +
      'Fai PRIMA tutte le ricerche, senza scrivere niente, e solo alla fine scrivi tutto il testo in una volta. ' +
      'Chiudi con un augurio di buona giornata. Al massimo 170 parole.'
  const messaggi: Record<string, unknown>[] = [{ role: 'user', content: 'Scrivi il testo della sveglia di stamattina.' }]
  const corpo: Record<string, unknown> = { model: VELOCE, max_tokens: 3000, system: sistema, messages: messaggi }
  if (sv.notizie) corpo.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]
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

// Una sveglia: (bambini: canzoncina) → testo → voce → annuncio sulla cassa → dopo la voce il Preferito Sonos a volume dolce.
async function suona(sv: Record<string, any>, prova: { cassa?: string; musica?: boolean; canzone?: number } = {}) {
  // Eccezioni di un giorno (es. settimana senza Davide e Celeste): { "2026-10-22": "Buongiorno Leo e Jolie…" }.
  const ecc = sv.eccezioni?.[oggiZurigo()]
  sv = { ...sv, saluto: (typeof ecc === 'string' ? ecc : ecc?.saluto) || sv.saluto }
  let tempo = 'meteo non disponibile'
  try { tempo = await meteo() } catch { /* senza meteo si va avanti lo stesso */ }
  let resto: string | null = null
  try { resto = await testoSveglia(sv, tempo) } catch (e) { console.error('testo sveglia', e) }
  const frase = `${sv.saluto} ${resto || `Oggi a Torricella: ${tempo}. Buona giornata!`}`
  const stile = sv.per === 'bambini'
    ? 'Leggi in italiano con tono allegro, dolce e un po\' buffo, come chi sveglia dei bambini con un sorriso'
    : 'Leggi in italiano con tono caldo e sorridente, ritmo sciolto da radio del mattino'
  const errori: string[] = []
  const msg = (e: unknown) => String((e as Error)?.message || e).slice(0, 200)
  let canto: Uint8Array | null = null
  if (sv.per === 'bambini') { try { canto = await canzone(prova.canzone) } catch (e) { errori.push(`canzone: ${msg(e)}`) } }
  let parlato: Uint8Array | null = null
  try { parlato = await parla(frase, stile) } catch (e) { errori.push(`voce: ${msg(e)}`) }
  const pezzi = ([canto, parlato].filter(Boolean) as Uint8Array[]).map(sfuma)
  const pcm = pezzi.length === 0 ? null
    : unisci(silenzio(0.4), ...pezzi.flatMap((p, i) => (i ? [silenzio(0.8), p] : [p])), silenzio(0.6))
  const token = await accesso()
  const tutte = await casse(token)
  const nomeCassa = prova.cassa || sv.cassa
  const c = tutte.find((x: any) => x.nome.toLowerCase() === nomeCassa.toLowerCase())
  if (!c) throw new Error(`Cassa non trovata: ${nomeCassa}`)
  // Senza voce (quota Google finita) la sveglia suona lo stesso: din-don di Sonos e poi la musica.
  const clip: Record<string, unknown> = { name: 'Second Brain', appId: 'ch.ceramex.secondbrain', priority: 'HIGH', volume: sv.volume_voce }
  let secondi = 3
  if (pcm) {
    clip.streamUrl = await salvaVoce(`sveglie/${sv.id}${prova.cassa ? '-prova' : ''}.wav`, pcm)
    secondi = pcm.length / 48000
  } else clip.clipType = 'CHIME'
  await sonos(token, `players/${c.id}/audioClip`, clip)
  const v = { secondi }
  let musica = 'niente'
  if (sv.preferito && prova.musica !== false) {
    await aspetta(Math.min(170, v.secondi + 2) * 1000)
    const hh = await casa(token)
    const { items } = await sonos(token, `households/${hh}/favorites`)
    // Nome senza maiuscole, spazi e segni ("Blink-182" = "blink 182"); va bene anche se uno contiene l'altro.
    const norma = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const voluto = norma(String(sv.preferito))
    const pref = (items || []).find((f: any) => norma(f.name) === voluto) ||
      (items || []).find((f: any) => norma(f.name).includes(voluto) || voluto.includes(norma(f.name)))
    if (!pref) throw new Error(`Preferito Sonos non trovato: ${sv.preferito} (va aggiunto nell'app Sonos)`)
    const { groups } = await sonos(token, `households/${hh}/groups`)
    const g = (groups || []).find((x: any) => (x.playerIds || []).includes(c.id))
    if (!g) throw new Error(`Gruppo della cassa ${c.nome} non trovato`)
    await sonos(token, `groups/${g.id}/groupVolume`, { volume: sv.volume_musica })
    await sonos(token, `groups/${g.id}/favorites`, { favoriteId: pref.id, playOnCompletion: true, action: 'REPLACE', playModes: { shuffle: true } })
    musica = pref.name
    // Dopo musica_minuti il giro di ogni minuto la mette in pausa (se nel frattempo non è cambiata).
    if (!prova.cassa) {
      await rest(`sonos_sveglie?id=eq.${sv.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        spegni_alle: new Date(Date.now() + (sv.musica_minuti || 5) * 60e3).toISOString(), spegni_gruppo: g.id, spegni_preferito: pref.name }) })
    }
  }
  return { testo: parlato ? frase : '(senza voce: din-don)', secondi: Math.round(v.secondi), musica, errori: errori.join(' | ') || undefined }
}

// --- Pagina Sveglie dell'app ---
// Giorno della settimana (1 = lunedì) di una data 'YYYY-MM-DD'.
const giornoDi = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
const dataTra = (giorni: number) => new Date(Date.now() + giorni * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
// I 7 giorni della settimana di oggi, da lunedì a domenica.
function settimana() {
  const lun = -(giornoDi(oggiZurigo()) - 1)
  return Array.from({ length: 7 }, (_, i) => ({ data: dataTra(lun + i), giorno: i + 1 }))
}

// Sveglie, stato di "senza Alessia" questa settimana e prossima sveglia (giorni speciali e vacanze compresi).
async function elencoSveglie() {
  const da = oggiZurigo(), a = dataTra(8)
  const [sveglie, speciali, vacanze] = await Promise.all([
    rest('sonos_sveglie?select=id,nome,cassa,giorni,ora,saluto,per,preferito,attiva,salta_vacanze,eccezioni,volume_voce,volume_musica,musica_minuti,ultima_il,ultimo_testo,errore&order=id') as Promise<Record<string, any>[]>,
    rest(`sonos_giorni?data=gte.${da}&data=lte.${a}&select=data,come,nota`) as Promise<Record<string, any>[]>,
    rest(`eventi?titolo=ilike.Scuola%20chiusa*&inizio=gte.${da}T00:00:00Z&inizio=lte.${a}T23:59:59Z&select=inizio`) as Promise<Record<string, any>[]>,
  ])
  const chiusa = new Set(vacanze.map((v) => String(v.inizio).slice(0, 10)))
  const ora = new Date().toLocaleTimeString('sv-SE', { timeZone: 'Europe/Zurich' }).slice(0, 5)
  let prossima = null
  // Giorno per giorno quali sveglie suonano davvero (giorni speciali, eccezioni e vacanze compresi): serve al Capo
  // per cambiare la sveglia giusta (es. venerdì senza Alessia suona quella di lunedì–mercoledì).
  const prossimi_giorni: Record<string, unknown>[] = []
  for (let i = 0; i <= 7; i++) {
    const data = dataTra(i)
    const giorno = speciali.find((s) => s.data === data)?.come || giornoDi(data)
    const lista = sveglie.filter((s) => s.attiva && s.giorni.includes(giorno) && !(s.salta_vacanze && chiusa.has(data)))
      .map((s) => {
        const e = s.eccezioni?.[data]
        return { id: s.id, nome: s.nome, cassa: s.cassa, ora: (typeof e === 'object' && e?.ora) || s.ora.slice(0, 5), spenta: typeof e === 'object' && !!e?.spenta }
      })
    prossimi_giorni.push({ data, giorno_settimana: giornoDi(data), come_giorno: giorno, scuola_chiusa: chiusa.has(data), sveglie: lista })
  }
  for (let i = 0; i <= 8 && !prossima; i++) {
    const data = dataTra(i)
    const giorno = speciali.find((s) => s.data === data)?.come || giornoDi(data)
    // Eccezioni di un giorno: altra ora o spenta solo quel giorno.
    const delGiorno = (s: Record<string, any>) => {
      const e = s.eccezioni?.[data]
      return { ...s, ora: (typeof e === 'object' && e?.ora) || s.ora.slice(0, 5), spenta: typeof e === 'object' && !!e?.spenta }
    }
    const candidate = sveglie.map(delGiorno)
      .filter((s) => s.attiva && !s.spenta && s.giorni.includes(giorno) && !(s.salta_vacanze && chiusa.has(data)))
      .filter((s) => i > 0 || (s.ora > ora && s.ultima_il !== data))
      .sort((x, y) => x.ora.localeCompare(y.ora))
    if (candidate[0]) prossima = { data, ora: candidate[0].ora, cassa: candidate[0].cassa, nome: candidate[0].nome }
  }
  const gioVen = settimana().filter((x) => x.giorno >= 4 && x.giorno <= 5 && x.data >= da)
  return {
    sveglie, prossima, prossimi_giorni,
    senza_alessia: gioVen.length > 0 && gioVen.every((x) => speciali.some((s) => s.data === x.data && s.come === 1)),
    senza_alessia_possibile: gioVen.length > 0,
  }
}

// Frasi standard delle sveglie (24.10.2026, Giovanni): la nuova sveglia dall'app sceglie una di queste, non testo libero.
const FRASI = [
  { chiave: 'leo_jolie', saluto: 'Buongiorno Leo e Jolie, dormito bene?', per: 'bambini', notizie: false, preferito: 'Alternative', nome: 'Leo e Jolie' },
  { chiave: 'quattro', saluto: 'Buongiorno Leo, Jolie, Davide e Celeste, dormito bene?', per: 'bambini', notizie: false, preferito: 'Alternative', nome: 'Leo, Jolie, Davide e Celeste' },
  { chiave: 'giovanni', saluto: 'Buongiorno Giovanni!', per: 'giovanni', notizie: true, preferito: 'This Is Worakls', nome: 'Giovanni' },
  { chiave: 'amore', saluto: 'Buongiorno Amore!', per: 'giovanni', notizie: true, preferito: 'This Is blink-182', nome: 'Amore' },
]
const NOMI_GIORNI = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const etichettaGiorni = (g: number[]) => {
  const s = [...g].sort()
  return s.length > 1 && s.every((x, i) => i === 0 || x === s[i - 1] + 1)
    ? `${NOMI_GIORNI[s[0]]}-${NOMI_GIORNI[s[s.length - 1]]}` : s.map((x) => NOMI_GIORNI[x]).join(', ')
}

// Nuova sveglia dall'app: giorni, ora, cassa, una frase standard e (se vuole) un Preferito Sonos.
async function nuovaSveglia(d: Record<string, any>) {
  const giorni = [...new Set((Array.isArray(d.giorni) ? d.giorni : []).map(Number))].filter((x) => x >= 1 && x <= 7).sort()
  if (!giorni.length) throw new Error('Scegli almeno un giorno')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.ora))) throw new Error('Ora non valida')
  const frase = FRASI.find((f) => f.chiave === d.frase)
  if (!frase) throw new Error('Scegli una frase')
  const token = await accesso()
  const cassa = (await casse(token)).find((c: any) => c.nome === d.cassa)
  if (!cassa) throw new Error('Scegli una cassa')
  let preferito: string | null = frase.preferito
  if (d.preferito !== undefined) {
    if (d.preferito === null || d.preferito === '') preferito = null
    else {
      const { items } = await sonos(token, `households/${await casa(token)}/favorites`)
      if (!(items || []).some((f: any) => f.name === d.preferito)) throw new Error('Preferito Sonos non trovato')
      preferito = d.preferito
    }
  }
  const camera = cassa.nome === 'Camera Mia'
  const volumi = campiVolume(d)
  await rest('sonos_sveglie', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    nome: `${frase.nome} ${etichettaGiorni(giorni)}`, cassa: cassa.nome, giorni, ora: d.ora, saluto: frase.saluto, per: frase.per,
    notizie: frase.notizie, preferito, volume_voce: camera ? 15 : 20, volume_musica: camera ? 5 : 9, ...volumi, salta_vacanze: true }) })
  return await elencoSveglie()
}

// Volumi delle sveglie (27.10.2026, Giovanni li sceglie nell'app): voce 5–60, musica 1–60, come per il Capo.
const VOLUMI = [['volume_voce', 5, 60], ['volume_musica', 1, 60]] as const
function campiVolume(d: Record<string, any>) {
  const campi: Record<string, number> = {}
  for (const [k, min, max] of VOLUMI) {
    if (d[k] == null) continue
    const n = Math.round(Number(d[k]))
    if (!(n >= min && n <= max)) throw new Error(`Volume ${k === 'volume_voce' ? 'voce' : 'musica'} tra ${min} e ${max}`)
    campi[k] = n
  }
  return campi
}

// Giovedì e venerdì di questa settimana (da oggi in avanti) come lunedì, o di nuovo normali.
async function senzaAlessia(attiva: boolean) {
  const g = settimana().filter((x) => x.giorno >= 4 && x.giorno <= 5 && x.data >= oggiZurigo()).map((x) => x.data)
  if (!g.length) return
  if (attiva) {
    await rest('sonos_giorni', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(g.map((data) => ({ data, come: 1, nota: 'Senza Alessia' }))) })
  } else await rest(`sonos_giorni?data=in.(${g.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
}

// --- Messaggi a un'ora precisa (27.10.2026, Giovanni) ---
// Un giorno, un'ora, una o più stanze e il testo scritto da lui (letto così com'è, senza Claude). La voce si fa una
// volta sola quando salva (si ritrova dall'impronta del testo) e vale per tutte le stanze.
const ORA_OK = /^([01]\d|2[0-3]):[0-5]\d$/
const adessoZurigo = () => new Date().toLocaleTimeString('sv-SE', { timeZone: 'Europe/Zurich' }).slice(0, 5)
const messaggioDi = (e: unknown) => String((e as Error)?.message || e).slice(0, 200)

// Per la pagina: da ieri in avanti (quelli già detti restano visibili un giorno).
const elencoMessaggi = () =>
  rest(`sonos_messaggi?data=gte.${dataTra(-1)}&select=id,data,ora,casse,testo,volume,detto_il,dette,errore&order=data,ora`)

async function nuovoMessaggio(d: Record<string, any>) {
  const data = String(d.data || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < oggiZurigo() || data > dataTra(60)) throw new Error('Giorno non valido')
  if (!ORA_OK.test(String(d.ora))) throw new Error('Ora non valida')
  if (data === oggiZurigo() && d.ora <= adessoZurigo()) throw new Error('Quest\'ora è già passata')
  const testo = String(d.testo || '').replace(/\s+/g, ' ').trim()
  if (!testo || testo.length > 300) throw new Error('Scrivi il messaggio (al massimo 300 caratteri)')
  const volume = d.volume == null ? 20 : Math.round(Number(d.volume))
  if (!(volume >= 5 && volume <= 60)) throw new Error('Volume tra 5 e 60')
  const token = await accesso()
  const buone = (await casse(token)).filter((c: any) => c.annunci).map((c: any) => c.nome as string)
  const scelte = [...new Set((Array.isArray(d.casse) ? d.casse : []).map(String))].filter((c) => buone.includes(c))
  if (!scelte.length) throw new Error('Scegli almeno una stanza')
  const doppio = 'Questo messaggio c\'è già, a quell\'ora'
  const gia = await rest(`sonos_messaggi?data=eq.${data}&ora=eq.${d.ora}&detto_il=is.null&select=testo`) as Record<string, any>[]
  if (gia.some((x) => x.testo === testo)) throw new Error(doppio)
  let errore: string | null = null
  try { await voce(testo) } catch (e) { errore = `Voce non ancora pronta (${messaggioDi(e)}): la riprovo all'ora giusta` }
  try {
    await rest('sonos_messaggi', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ data, ora: d.ora, casse: scelte, testo, volume, errore }) })
  } catch (e) {
    if (/ 409 /.test(messaggioDi(e))) throw new Error(doppio)
    throw e
  }
  return { ok: true, voce_pronta: !errore }
}

// Giro di ogni minuto: i messaggi arrivati all'ora, ciascuno una volta sola, in tutte le sue stanze.
async function messaggi() {
  const ids = (await rest('rpc/sonos_messaggi_da_fare', { method: 'POST', body: '{}' }) as number[]) || []
  for (const id of ids) {
    // "In corso" finché non ha finito: se la funzione si ferma a metà, nella pagina non sembra detto.
    const prese = await rest(`sonos_messaggi?id=eq.${id}&detto_il=is.null`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ detto_il: new Date().toISOString(), errore: 'In corso…' }),
    }) as Record<string, any>[]
    const m = prese?.[0]
    if (!m) continue
    const errori: string[] = [], dette: string[] = []
    try {
      const token = await accesso()
      // Senza voce niente din-don (ai bimbi non direbbe niente): resta "Non detto" con l'errore in rosso.
      const { url } = await voce(m.testo)
      const tutte = await casse(token)
      for (const nome of m.casse as string[]) {
        const c = tutte.find((x: any) => x.nome === nome)
        if (!c) { errori.push(`${nome}: cassa non trovata`); continue }
        const clip = { name: 'Second Brain', appId: 'ch.ceramex.secondbrain', priority: 'HIGH', volume: m.volume, streamUrl: url }
        try { await sonos(token, `players/${c.id}/audioClip`, clip); dette.push(nome) } catch (e) { errori.push(`${nome}: ${messaggioDi(e)}`) }
      }
    } catch (e) { errori.push(messaggioDi(e)) }
    await rest(`sonos_messaggi?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ dette, errore: errori.join(' | ').slice(0, 300) || null }) }).catch(() => {})
  }
}

// Annuncio su una cassa: la frase detta da Laomedeia (senza frase: il din-don di Sonos).
async function annuncia(token: string, cassa: unknown, testo: unknown, volume?: unknown, stile?: unknown) {
  const tutte = await casse(token)
  const scelta = tutte.find((c: any) => c.id === cassa || c.nome.toLowerCase() === String(cassa || '').toLowerCase())
  if (!scelta) throw new Error(`Cassa non trovata: ${cassa} (ci sono ${tutte.map((c: any) => c.nome).join(', ')})`)
  if (!scelta.annunci) throw new Error(`${scelta.nome} non fa gli annunci`)
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
  return { cassa: scelta.nome, clip: r?.id, voce_nuova: nuova }
}

// Una cosa preparata dal Capo (capo_conferme tipo 'sonos') e confermata da Giovanni con i due tocchi.
// I dati li ha scritti il Capo, che legge anche mail di estranei: qui si accetta SOLO questo elenco chiuso, controllato.
//   { tipo: 'annuncio', cassa, testo }                       → annuncio (al massimo 300 caratteri)
//   { tipo: 'sveglia', id, ora?, attiva?, volume_voce?, volume_musica?, musica_minuti? } → cambio per sempre
//   { tipo: 'sveglia_giorno', id, data, ora?, spenta? }       → solo quel giorno (da oggi a 30 giorni)
//   { tipo: 'giorno', data, come }                            → quel giorno fa come un altro (come null = normale)
//   { tipo: 'senza_alessia', attiva }                         → giovedì e venerdì di questa settimana come lunedì
async function eseguiConferma(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Conferma non valida')
  const [c] = await rest(`capo_conferme?id=eq.${id}&select=id,tipo,stato,dati`) as Record<string, any>[]
  if (!c || c.tipo !== 'sonos') throw new Error('Conferma non trovata')
  if (c.stato !== 'confermata') throw new Error('Questa cosa non è confermata')
  const chiudi = (stato: string, esito: string) => rest(`capo_conferme?id=eq.${id}&stato=eq.confermata`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stato, esito, fatta_il: new Date().toISOString() }) })
  const d = c.dati || {}
  const ORA = /^([01]\d|2[0-3]):[0-5]\d$/
  const dataOk = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= oggiZurigo() && x <= dataTra(30)
  const sveglia = async (x: unknown) => {
    const [s] = await rest(`sonos_sveglie?id=eq.${Number(x) || 0}&select=id,nome,eccezioni`) as Record<string, any>[]
    if (!s) throw new Error('Sveglia non trovata')
    return s
  }
  try {
    let esito = ''
    if (d.tipo === 'annuncio') {
      const frase = String(d.testo || '').trim()
      if (!frase || frase.length > 300) throw new Error('Testo dell\'annuncio vuoto o troppo lungo')
      const fatto = await annuncia(await accesso(), d.cassa, frase)
      esito = `Detto in ${fatto.cassa}`
    } else if (d.tipo === 'sveglia') {
      const s = await sveglia(d.id)
      const campi: Record<string, unknown> = {}
      if (d.ora != null) { if (!ORA.test(String(d.ora))) throw new Error('Ora non valida'); campi.ora = d.ora }
      if (d.attiva != null) campi.attiva = !!d.attiva
      for (const [k, min, max] of [['volume_voce', 5, 60], ['volume_musica', 1, 60], ['musica_minuti', 1, 180]] as const) {
        if (d[k] == null) continue
        const n = Math.round(Number(d[k]))
        if (!(n >= min && n <= max)) throw new Error(`${k} deve stare tra ${min} e ${max}`)
        campi[k] = n
      }
      if (!Object.keys(campi).length) throw new Error('Niente da cambiare')
      await rest(`sonos_sveglie?id=eq.${s.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })
      esito = `Sveglia cambiata: ${s.nome}`
    } else if (d.tipo === 'sveglia_giorno') {
      const s = await sveglia(d.id)
      if (!dataOk(d.data)) throw new Error('Giorno non valido')
      const prima = s.eccezioni?.[d.data]
      const e: Record<string, unknown> = typeof prima === 'string' ? { saluto: prima } : { ...(prima || {}) }
      if (d.ora != null) { if (!ORA.test(String(d.ora))) throw new Error('Ora non valida'); e.ora = d.ora }
      if (d.spenta != null) e.spenta = !!d.spenta
      await rest(`sonos_sveglie?id=eq.${s.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ eccezioni: { ...(s.eccezioni || {}), [d.data]: e } }) })
      esito = `Solo il ${d.data}: ${s.nome}`
    } else if (d.tipo === 'giorno') {
      if (!dataOk(d.data)) throw new Error('Giorno non valido')
      if (d.come == null) await rest(`sonos_giorni?data=eq.${d.data}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      else {
        const come = Number(d.come)
        if (!(come >= 1 && come <= 7)) throw new Error('Giorno della settimana non valido')
        await rest('sonos_giorni', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ data: d.data, come, nota: 'Dal Capo' }) })
      }
      esito = `Giorno ${d.data} sistemato`
    } else if (d.tipo === 'senza_alessia') {
      await senzaAlessia(!!d.attiva)
      esito = d.attiva ? 'Giovedì e venerdì come lunedì–mercoledì' : 'Giovedì e venerdì di nuovo normali'
    } else throw new Error('Cosa da fare sconosciuta')
    await chiudi('fatta', esito)
    return { ok: true, esito }
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    await chiudi('non_fatta', errore).catch(() => {})
    throw e
  }
}

// Giro di ogni minuto: prende le sveglie da fare (una volta sola al giorno ciascuna) e le suona in sottofondo.
// Musica delle sveglie da fermare: pausa solo se in quel gruppo suona ancora il Preferito della sveglia
// (se Giovanni ha messo altro, non si tocca).
async function spegniMusica() {
  const righe = await rest(`sonos_sveglie?spegni_alle=lte.${new Date().toISOString()}&select=id,spegni_gruppo,spegni_preferito`) as Record<string, any>[]
  if (!righe.length) return
  const token = await accesso()
  const norma = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const r of righe) {
    try {
      const m = await sonos(token, `groups/${r.spegni_gruppo}/playbackMetadata`).catch(() => null)
      const nome = norma(m?.container?.name || '')
      // Senza nome (Sonos non lo dice) si ferma lo stesso: l'ultima cosa partita lì è la sveglia.
      if (!nome || nome.includes(norma(r.spegni_preferito)) || norma(r.spegni_preferito).includes(nome)) {
        await sonos(token, `groups/${r.spegni_gruppo}/playback/pause`, {})
      }
    } catch (e) {
      console.error('spegni musica', e)
    }
    await rest(`sonos_sveglie?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ spegni_alle: null, spegni_gruppo: null, spegni_preferito: null }) })
  }
}

async function sveglie() {
  await spegniMusica().catch((e) => console.error('spegni musica', e))
  // Prima i messaggi: hanno un'ora precisa, una sveglia può aspettare la fine della voce prima della musica.
  await messaggi().catch((e) => console.error('messaggi', e))
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
      await rest(`sonos_sveglie?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ultimo_testo: fatto.testo, errore: fatto.errori || null }) })
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

  const corpoJson = await req.json().catch(() => ({}))
  const { azione, cassa, volume, testo, stile, id, musica, canzone: numeroCanzone } = corpoJson
  if (azione === 'sveglie') {
    if (!programmato) return risposta({ errore: 'Non autorizzato' }, 401)
    // @ts-ignore EdgeRuntime c'è nelle funzioni Supabase: il lavoro continua dopo la risposta.
    EdgeRuntime.waitUntil(sveglie().catch((e) => console.error('sveglie', e)))
    return risposta({ ok: true })
  }
  try {
    if (azione === 'sveglie_elenco') {
      const d = await elencoSveglie()
      if (!corpoJson.completo) return risposta(d)
      // Per "Nuova sveglia" nella pagina: frasi standard, casse e Preferiti Sonos (se Sonos risponde).
      let casseNomi: string[] = [], preferiti: string[] = []
      try {
        const token = await accesso()
        casseNomi = (await casse(token)).filter((c: any) => c.annunci).map((c: any) => c.nome)
        const { items } = await sonos(token, `households/${await casa(token)}/favorites`)
        preferiti = (items || []).map((f: any) => f.name)
      } catch (e) { console.error('elenco completo', e) }
      // I messaggi solo qui (pagina dell'app), non nell'elenco corto che legge il Capo.
      const elencoM = await elencoMessaggi().catch((e) => { console.error('messaggi', e); return [] })
      return risposta({ ...d, frasi: FRASI, casse: casseNomi, preferiti, messaggi: elencoM })
    }
    if (azione === 'messaggio_nuovo') return risposta(await nuovoMessaggio(corpoJson))
    if (azione === 'messaggio_togli') {
      await rest(`sonos_messaggi?id=eq.${Number(id) || 0}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      return risposta({ ok: true })
    }
    if (azione === 'sveglia_nuova') return risposta(await nuovaSveglia(corpoJson))
    if (azione === 'sveglia_togli') {
      await rest(`sonos_sveglie?id=eq.${Number(id) || 0}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      return risposta(await elencoSveglie())
    }
    if (azione === 'sveglia_cambia') {
      const campi: Record<string, unknown> = {}
      const { ora, attiva } = corpoJson
      if (ora != null) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(ora))) return risposta({ errore: 'Ora non valida' }, 400)
        campi.ora = ora
      }
      if (attiva != null) campi.attiva = !!attiva
      try { Object.assign(campi, campiVolume(corpoJson)) } catch (e) { return risposta({ errore: (e as Error).message }, 400) }
      if (!Object.keys(campi).length) return risposta({ errore: 'Niente da cambiare' }, 400)
      await rest(`sonos_sveglie?id=eq.${Number(id) || 0}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })
      return risposta(await elencoSveglie())
    }
    if (azione === 'senza_alessia') {
      await senzaAlessia(!!corpoJson.attiva)
      return risposta(await elencoSveglie())
    }
    if (azione === 'esegui_conferma') {
      // Solo Giovanni dall'app, subito dopo i suoi due tocchi su una conferma 'sonos' preparata dal Capo.
      if (programmato) return risposta({ errore: 'Non autorizzato' }, 401)
      return risposta(await eseguiConferma(String(id || '')))
    }
    if (azione === 'sveglia_prova') {
      const [sv] = await rest(`sonos_sveglie?id=eq.${Number(id) || 0}&select=*`) as Record<string, any>[]
      if (!sv) return risposta({ errore: 'Sveglia non trovata' }, 400)
      return risposta(await suona(sv, { cassa: cassa ? String(cassa) : undefined, musica: musica !== false,
        canzone: numeroCanzone == null ? undefined : Number(numeroCanzone) }))
    }
    if (azione === 'collega') {
      const stato = crypto.randomUUID()
      await salva({ stato_oauth: stato, stato_oauth_il: new Date().toISOString() })
      const q = new URLSearchParams({ client_id: SONOS_KEY, response_type: 'code', state: stato, scope: 'playback-control-all', redirect_uri: RITORNO })
      return risposta({ link: `${LOGIN}?${q}` })
    }
    const token = await accesso()
    if (azione === 'casse') return risposta({ casse: await casse(token) })
    if (azione === 'modelli_voce') {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': GEMINI_API_KEY || '' } })
      const j = await r.json().catch(() => ({}))
      return risposta({ modelli: (j.models || []).map((m: any) => m.name).filter((n: string) => /tts/i.test(n)) })
    }
    if (azione === 'preferiti') {
      const { items } = await sonos(token, `households/${await casa(token)}/favorites`)
      return risposta({ preferiti: (items || []).map((f: any) => ({ id: f.id, nome: f.name, servizio: f.service?.name })) })
    }
    if (azione === 'annuncio') return risposta({ ok: true, ...(await annuncia(token, cassa, testo, volume, stile)) })
    return risposta({ errore: 'Azione sconosciuta' }, 400)
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    await salva({ errore }).catch(() => {})
    return risposta({ errore }, 502)
  }
})
