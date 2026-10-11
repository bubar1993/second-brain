// Legge la casella info@homeconcepts.ch (IMAP Hostpoint) e salva le mail nel second brain (fase 5).
// La chiama pg_cron ogni 5 minuti. Apre le cartelle in SOLA LETTURA: non segna niente come letto,
// non sposta e non cancella. Poi allinea le conversazioni e annulla le bozze superate
// (qualcuno ha già risposto o è arrivata una mail nuova nella stessa conversazione).
// Storico: a ogni giro legge anche un pezzo di mail vecchie (scendendo), finché arriva all'inizio.
// Per stare nei limiti della funzione (poco calcolo) si scarica solo il testo della mail:
// gli allegati restano nella casella, qui si salvano solo nome, tipo e peso.
import { ImapFlow } from 'npm:imapflow@1.0.171'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const IO = 'info@homeconcepts.ch'
const CARTELLE: [string, 'arrivata' | 'inviata'][] = [['INBOX', 'arrivata'], ['Sent', 'inviata']]
const PEZZO_NUOVE = 60     // mail nuove per cartella e per giro
const PEZZO_STORICO = 40   // mail vecchie per cartella e per giro
const LIMITE_MS = 110000   // poi si ferma e riprende al giro dopo

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}
const rpc = (fn: string) => rest(`rpc/${fn}`, { method: 'POST', body: '{}' })

const pulisciId = (s?: string | null) => (s || '').trim().replace(/^<|>$/g, '')
const listaId = (s?: string | null) => ((s || '').match(/<[^>]+>/g) || []).map(pulisciId).filter(Boolean)
const indirizzo = (a?: { address?: string }) => (a?.address || '').toLowerCase()
const indirizzi = (l?: { address?: string }[]) => (l || []).map(indirizzo).filter(Boolean)

// HTML → testo leggibile.
const daHtml = (html: string) => html
  .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')

// Dalla struttura della mail: quale parte è il testo e quali sono gli allegati.
type Nodo = { part?: string, type?: string, size?: number, disposition?: string, parameters?: Record<string, string>,
  dispositionParameters?: Record<string, string>, childNodes?: Nodo[] }
function parti(n: Nodo | undefined, out = { testo: '', html: '', allegati: [] as { nome?: string, tipo?: string, kb: number }[] }) {
  if (!n) return out
  if (n.childNodes?.length) { n.childNodes.forEach((c) => parti(c, out)); return out }
  const nome = n.dispositionParameters?.filename || n.parameters?.name
  if (nome || n.disposition === 'attachment') out.allegati.push({ nome, tipo: n.type, kb: Math.round((n.size || 0) / 1024) })
  else if (n.type === 'text/plain' && !out.testo) out.testo = n.part || '1'
  else if (n.type === 'text/html' && !out.html) out.html = n.part || '1'
  return out
}

async function scarica(client: ImapFlow, uid: number, parte: string) {
  const { content } = await client.download(String(uid), parte, { uid: true, maxBytes: 150000 })
  const pezzi: Uint8Array[] = []
  for await (const p of content) pezzi.push(typeof p === 'string' ? new TextEncoder().encode(p) : p)
  return new TextDecoder().decode(await new Blob(pezzi).arrayBuffer())
}

// Legge un blocco di mail: prima busta e struttura (leggere), poi solo la parte di testo di ognuna.
async function leggiBlocco(client: ImapFlow, da: number, a: number, cartella: 'arrivata' | 'inviata', fino: number) {
  const msgs = await client.fetchAll(`${da}:${a}`, { uid: true, envelope: true, bodyStructure: true, headers: ['references'] }, { uid: true })
  const righe = []
  for (const m of msgs) {
    if (Date.now() > fino) break
    try {
      const e = m.envelope || {}
      const p = parti(m.bodyStructure as Nodo)
      let testo = ''
      if (p.testo) testo = await scarica(client, m.uid, p.testo)
      else if (p.html) testo = daHtml(await scarica(client, m.uid, p.html))
      const id = pulisciId(e.messageId) || `uid-${cartella}-${m.uid}@${IO}`
      const rif = listaId(m.headers ? new TextDecoder().decode(m.headers) : '')
      const risponde = listaId(e.inReplyTo)[0] || null
      righe.push({
        message_id: id, utente_id: UTENTE, area: 'G', cartella,
        thread_key: rif[0] || risponde || id, in_reply_to: risponde, riferimenti: rif,
        da: indirizzo(e.from?.[0]), da_nome: e.from?.[0]?.name || null, a: indirizzi(e.to), cc: indirizzi(e.cc),
        oggetto: e.subject || null, data: e.date ? new Date(e.date).toISOString() : null,
        testo: testo.slice(0, 60000), allegati: p.allegati, fonte: 'imap', imap_uid: m.uid,
      })
    } catch (_) { /* mail illeggibile: si salta */ }
  }
  return righe
}

// Salva: se la mail c'era già (copiata dal gestionale) aggiorna i campi della casella e tiene cliente/cantiere/nota.
async function salva(righe: Record<string, unknown>[]) {
  for (let i = 0; i < righe.length; i += 100) {
    await rest('posta?on_conflict=message_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(righe.slice(i, i + 100)),
    })
  }
}

async function leggi() {
  const password = Deno.env.get('GC_MAIL_PASSWORD')
  if (!password) return { saltato: 'manca GC_MAIL_PASSWORD' }
  const inizio = Date.now()
  const stati = new Map(((await rest('posta_stato?select=*')) as { cartella: string, uidvalidity: number, ultimo_uid: number, storico_uid: number | null }[])
    .map((s) => [s.cartella, s]))

  const client = new ImapFlow({
    host: 'imap.mail.hostpoint.ch', port: 993, secure: true,
    auth: { user: Deno.env.get('GC_MAIL_USER') || IO, pass: password },
    logger: false, emitLogs: false, connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 60000,
  })
  await client.connect()
  const esito: Record<string, unknown> = {}
  try {
    for (const [cartella, tipo] of CARTELLE) {
      const box = await client.mailboxOpen(cartella, { readOnly: true })
      const validity = Number(box.uidValidity)
      let s = stati.get(cartella)
      if (!s || Number(s.uidvalidity) !== validity) s = { cartella, uidvalidity: validity, ultimo_uid: 0, storico_uid: null }
      const prossimo = Number(box.uidNext) - 1
      let nuove = 0, vecchie = 0

      // Prima volta: si parte dalle ultime e lo storico scende da lì.
      if (!s.ultimo_uid) { s.ultimo_uid = Math.max(0, prossimo - PEZZO_NUOVE); s.storico_uid = s.ultimo_uid }

      // 1) Mail nuove.
      if (prossimo > s.ultimo_uid && box.exists > 0) {
        const fino = Math.min(prossimo, s.ultimo_uid + PEZZO_NUOVE)
        const righe = await leggiBlocco(client, s.ultimo_uid + 1, fino, tipo, inizio + LIMITE_MS)
        await salva(righe)
        nuove = righe.length
        // Se il tempo è finito a metà, si riparte dall'ultima letta.
        const completo = Date.now() < inizio + LIMITE_MS
        s.ultimo_uid = completo ? fino : Math.max(s.ultimo_uid, ...righe.map((r) => r.imap_uid))
      }

      // 2) Un pezzo di storico, se c'è tempo (se non finisce, al giro dopo si rilegge lo stesso pezzo).
      if (s.storico_uid && s.storico_uid > 0 && Date.now() - inizio < LIMITE_MS / 2) {
        const da = Math.max(1, s.storico_uid - PEZZO_STORICO + 1)
        const righe = await leggiBlocco(client, da, s.storico_uid, tipo, inizio + LIMITE_MS)
        await salva(righe)
        vecchie = righe.length
        if (Date.now() < inizio + LIMITE_MS) s.storico_uid = da === 1 ? 0 : da - 1
      }

      await rest('posta_stato?on_conflict=cartella', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ cartella, uidvalidity: validity, ultimo_uid: s.ultimo_uid, storico_uid: s.storico_uid, modificata_il: new Date().toISOString() }),
      })
      esito[cartella] = { nuove, vecchie, storico_fino_uid: s.storico_uid }
    }
  } finally {
    await client.logout().catch(() => client.close())
  }
  esito.thread_allineati = await rpc('posta_allinea_thread')
  esito.bozze_annullate = await rpc('annulla_bozze_superate')
  return esito
}

Deno.serve(async (req: Request) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) {
    return new Response('Non autorizzato', { status: 401 })
  }
  const iniziata_il = new Date().toISOString()
  let esito
  try {
    const dettagli = await leggi()
    esito = { ok: !('saltato' in dettagli), dettagli, errore: 'saltato' in dettagli ? String(dettagli.saltato) : null }
  } catch (e) {
    esito = { ok: false, dettagli: null, errore: String((e as Error)?.message || e).slice(0, 500) }
  }
  await rest('lavori_registro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lavoro: 'posta-gc', iniziata_il, ...esito }) })
    .catch(() => {})
  return new Response(JSON.stringify(esito), { status: esito.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
})
