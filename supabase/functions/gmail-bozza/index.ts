// Bozze Ceramex dalla Gmail di Giovanni (giovannifabris@ceramex.ch), 12.10.2026.
// La routine "Bozze mail Ceramex" crea la bozza in Gmail; copia-ceramex la porta nella tabella bozze.
// Questa funzione, chiamata solo dall'app con l'accesso di Giovanni:
//   leggi  → destinatari, oggetto e testo della bozza Gmail + la mail a cui risponde
//   invia  → aggiorna la bozza Gmail con le correzioni e la manda (resta nella stessa conversazione)
//   scarta → toglie la bozza da Gmail e la segna scartata
// Prima di inviare ricontrolla che nella conversazione non sia arrivato niente di nuovo.
// Collegamento Google: client OAuth "Second Brain Gmail" (pubblico Interno), segreti GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN
// messi da scripts/collega-gmail.mjs.

import { daConnettore } from '../_shared/accesso.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const IO = 'giovannifabris@ceramex.ch'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

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
  rest(`bozze?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...campi, modificata_il: new Date().toISOString() }) })

// --- Google ---
async function accesso() {
  const refresh = Deno.env.get('GMAIL_REFRESH_TOKEN')
  if (!refresh) throw new Errore('Gmail non è ancora collegata: si fa una volta sola dal PC.', 503)
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GMAIL_CLIENT_ID')!, client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  })
  const t = await r.json()
  if (!t.access_token) throw new Errore(`Collegamento Gmail scaduto (${t.error || r.status}): va rifatto dal PC.`, 503)
  return t.access_token as string
}

class Errore extends Error {
  constructor(msg: string, public status = 400) { super(msg) }
}

async function gmail(token: string, percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${GMAIL}/${percorso}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.status === 204 ? {} : r.json()
}

const daBase64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}
const aBase64 = (s: string) => {
  const byte = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin)
}
const aBase64Url = (s: string) => aBase64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

type Parte = { mimeType?: string; body?: { data?: string }; parts?: Parte[]; headers?: { name: string; value: string }[] }
const intestazione = (p: Parte, nome: string) => p.headers?.find((h) => h.name.toLowerCase() === nome.toLowerCase())?.value || ''

function testoDi(p: Parte): string {
  if (p.mimeType === 'text/plain' && p.body?.data) return daBase64(p.body.data)
  for (const x of p.parts || []) {
    const t = testoDi(x)
    if (t) return t
  }
  if (p.mimeType === 'text/html' && p.body?.data) {
    return daBase64(p.body.data).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim()
  }
  return ''
}
const indirizzi = (s: string) => [...new Set((s.match(/[^\s<>",;]+@[^\s<>",;]+/g) || []).map((x) => x.toLowerCase()))]
const nomeDi = (s: string) => s.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || s

// La mail a cui risponde e quello che è arrivato dopo nella conversazione.
async function conversazione(token: string, b: Record<string, any>) {
  if (!b.gmail_thread_id) return { originale: null, dopo: [] }
  const t = await gmail(token, `threads/${b.gmail_thread_id}?format=full`)
  if (!t) return { originale: null, dopo: [] }
  const vere = (t.messages || []).filter((m: any) => !(m.labelIds || []).includes('DRAFT'))
  const orig = vere.find((m: any) => m.id === b.gmail_message_id) || vere[vere.length - 1]
  const creata = new Date(b.creata_il).getTime()
  const dopo = vere.filter((m: any) => m !== orig && Number(m.internalDate) > creata)
  return {
    originale: orig && {
      da: indirizzi(intestazione(orig.payload, 'From'))[0] || '',
      da_nome: nomeDi(intestazione(orig.payload, 'From')),
      oggetto: intestazione(orig.payload, 'Subject'),
      data: new Date(Number(orig.internalDate)).toISOString(),
      testo: testoDi(orig.payload).slice(0, 20000),
    },
    dopo: dopo.map((m: any) => ({ da: indirizzi(intestazione(m.payload, 'From'))[0] || '' })),
  }
}

async function bozzaGmail(token: string, b: Record<string, any>) {
  if (!b.gmail_draft_id) return null
  const d = await gmail(token, `drafts/${b.gmail_draft_id}?format=full`)
  if (!d?.message) return null
  const p = d.message.payload as Parte
  return {
    threadId: d.message.threadId as string,
    a: indirizzi(intestazione(p, 'To')), cc: indirizzi(intestazione(p, 'Cc')),
    oggetto: intestazione(p, 'Subject'), testo: testoDi(p),
    inReplyTo: intestazione(p, 'In-Reply-To'), references: intestazione(p, 'References'),
  }
}

const parolaMime = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${aBase64(s)}?=`

function mime(m: { a: string[]; cc: string[]; oggetto: string; testo: string; inReplyTo?: string; references?: string }) {
  const righe = [
    `From: Giovanni Fabris <${IO}>`,
    `To: ${m.a.join(', ')}`,
    ...(m.cc.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    `Subject: ${parolaMime(m.oggetto)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    aBase64(m.testo.replace(/\r?\n/g, '\r\n')).replace(/.{76}/g, '$&\r\n'),
  ]
  return aBase64Url(righe.join('\r\n'))
}

const pulisci = (l?: string[] | null) => [...new Set((l || []).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))]

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  // Solo Giovanni.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
  const utente = u.ok ? await u.json() : null
  if (utente?.id !== UTENTE || daConnettore(jwt)) return risposta({ errore: 'Non autorizzato' }, 401)

  const { azione, id, testo, a, cc, oggetto } = await req.json().catch(() => ({}))
  if (!id) return risposta({ errore: 'Manca la bozza' }, 400)
  const [b] = await rest(`bozze?id=eq.${id}&select=*`) as Record<string, any>[]
  if (!b || b.canale !== 'gmail') return risposta({ errore: 'Bozza non trovata' }, 404)

  try {
    const token = await accesso()

    if (azione === 'leggi') {
      const [g, c] = await Promise.all([bozzaGmail(token, b), conversazione(token, b)])
      return risposta({ bozza: g && { a: g.a, cc: g.cc, oggetto: g.oggetto, testo: g.testo }, originale: c.originale, nuove: c.dopo.length })
    }

    if (azione === 'scarta') {
      if (b.stato !== 'proposta') return risposta({ errore: `La bozza è già ${b.stato}` }, 409)
      if (b.gmail_draft_id) await gmail(token, `drafts/${b.gmail_draft_id}`, { method: 'DELETE' })
      await aggiorna(id, { stato: 'scartata', testo: typeof testo === 'string' ? testo : b.testo })
      return risposta({ ok: true })
    }

    if (azione !== 'invia') return risposta({ errore: 'Azione sconosciuta' }, 400)
    if (b.stato !== 'proposta') {
      return risposta({ errore: b.stato === 'annullata' ? `Bozza annullata: ${b.motivo_annullata || 'qualcuno ha già risposto'}` : `La bozza è già ${b.stato}` }, 409)
    }
    const g = await bozzaGmail(token, b)
    if (!g) {
      await aggiorna(id, { stato: 'annullata', annullata_il: new Date().toISOString(), motivo_annullata: 'La bozza non c\'è più in Gmail' })
      return risposta({ errore: 'La bozza non c\'è più in Gmail (forse l\'hai già mandata o cancellata da lì).' }, 409)
    }
    const c = await conversazione(token, b)
    if (c.dopo.length) {
      const io = c.dopo.some((m) => m.da === IO)
      await aggiorna(id, { stato: 'annullata', annullata_il: new Date().toISOString(),
        motivo_annullata: io ? 'Hai già risposto da Gmail' : 'È arrivata una mail nuova nella conversazione' })
      return risposta({ errore: io ? 'Hai già risposto da Gmail: bozza annullata.' : 'Nel frattempo è arrivata una mail nuova: bozza annullata. Rileggi la conversazione in Gmail.' }, 409)
    }

    const destinatari = pulisci(a?.length ? a : g.a)
    const copia = pulisci(cc ?? g.cc).filter((x) => !destinatari.includes(x) && x !== IO)
    if (!destinatari.length) return risposta({ errore: 'Manca il destinatario' }, 400)
    const corpo = String(testo ?? g.testo ?? '').trim()
    if (!corpo) return risposta({ errore: 'Il testo è vuoto' }, 400)
    const ogg = String(oggetto ?? g.oggetto ?? '').trim()

    // Blocco subito la bozza: niente doppi invii se si tocca due volte.
    await rest(`bozze?id=eq.${id}&stato=eq.proposta`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ stato: 'in_invio', testo: corpo, a: destinatari, cc: copia, oggetto: ogg }) })
    try {
      const raw = mime({ a: destinatari, cc: copia, oggetto: ogg, testo: corpo, inReplyTo: g.inReplyTo, references: g.references })
      await gmail(token, `drafts/${b.gmail_draft_id}`, { method: 'PUT', body: JSON.stringify({ id: b.gmail_draft_id, message: { raw, threadId: g.threadId } }) })
      const inviata = await gmail(token, 'drafts/send', { method: 'POST', body: JSON.stringify({ id: b.gmail_draft_id }) })
      const ora = new Date().toISOString()
      await aggiorna(id, { stato: 'inviata', inviata_il: ora, inviata_message_id: inviata?.id || null, errore: null })
      return risposta({ ok: true, inviata_il: ora })
    } catch (e) {
      const errore = String((e as Error)?.message || e).slice(0, 300)
      await aggiorna(id, { stato: 'proposta', errore: `Invio non riuscito: ${errore}` })
      return risposta({ errore: `Invio non riuscito: ${errore}` }, 502)
    }
  } catch (e) {
    return risposta({ errore: String((e as Error)?.message || e).slice(0, 300) }, (e as Errore).status || 500)
  }
})
