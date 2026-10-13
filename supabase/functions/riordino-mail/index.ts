// Riordino delle caselle: info@homeconcepts.ch (Hostpoint, cartelle) dal 12.10.2026 sera e Gmail Ceramex (etichette)
// dal 12.10.2026 notte, ok di Giovanni.
// L'agente propone la cartella (tabella riordino_mail); Giovanni spunta nell'app e preme "Sposta":
// questa funzione sposta SOLO le mail scelte da lui (IMAP MOVE su Hostpoint). Non cancella e non invia niente.
// Crea una cartella solo se è la cartella nuova proposta dall'agente (✚) e Giovanni l'ha approvata.
// Azioni: { azione: 'cartelle', casella? } → cartelle di info@ (dall'ultima lettura di posta-gc) o etichette Gmail;
//         { azione: 'sposta', voci: [{ id, cartella? }] } → sposta (cartella = correzione di Giovanni).
//         { azione: 'leggi', id } → testo della mail (info@) o degli ultimi messaggi della conversazione (Gmail), con gli allegati;
//         { azione: 'allegato', id, rif } → un allegato in base64 (13.10.2026, richiesta di Giovanni). Solo lettura: non segna come letta.
//         { azione: 'rispondi', id, testo, tutti? }  → risposta nella stessa conversazione (13.10.2026 sera, "via di mezzo" scelta da Giovanni);
//         { azione: 'inoltra', id, testo, a: [mail] } → inoltro con gli allegati.
//         info@ parte da SMTP Hostpoint con la copia in "Sent"; Ceramex dalla Gmail (stessa conversazione). L'app chiede due tocchi.
//         Con prova: true (anche col token della copia, per i controlli) prepara la mail e dice cosa manderebbe, senza mandarla.
import { ImapFlow } from 'npm:imapflow@1.0.171'
import PostalMime from 'npm:postal-mime@2.4.3'
import nodemailer from 'npm:nodemailer@6.9.16'
import MailComposer from 'npm:nodemailer@6.9.16/lib/mail-composer/index.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const IO = Deno.env.get('GC_MAIL_USER') || 'info@homeconcepts.ch'
const MASSIMO = 60 // mail per chiamata

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
  rest(`riordino_mail?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...campi, aggiornata_il: new Date().toISOString() }) })

// I nomi delle cartelle possono arrivare come li scrive il server (UTF-7 IMAP: "G&-C" = "G&C"):
// qui si usano sempre in chiaro, come li dà imapflow.
function inChiaro(nome: string) {
  return nome.replace(/&([^-]*)-/g, (_, b64: string) => {
    if (!b64) return '&'
    const b = b64.replace(/,/g, '/')
    const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4))
    return new TextDecoder('utf-16be').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  })
}
const senzaParentesi = (id: string) => id.trim().replace(/^<|>$/g, '')

// --- Gmail Ceramex (etichette) ---
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
async function accessoGmail() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GMAIL_CLIENT_ID')!, client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GMAIL_REFRESH_TOKEN') || '', grant_type: 'refresh_token' }),
  })
  const t = await r.json()
  if (!t.access_token) throw new Error(`collegamento Gmail non valido (${t.error || r.status}): va rifatto dal PC`)
  return t.access_token as string
}
async function gmail(token: string, percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${GMAIL}/${percorso}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
  if (r.status === 404) return null
  if (r.status === 403) throw new Error('Gmail non dà il permesso di spostare: va rifatto il collegamento dal PC (permesso "modifica")')
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
const etichetteUtente = async (token: string) =>
  ((await gmail(token, 'labels'))?.labels || []).filter((l: any) => l.type === 'user') as { id: string, name: string }[]

// --- Leggere una mail (testo e allegati) ---
const MAX_TESTO = 20000
const MAX_ALLEGATO = 12 * 1024 * 1024
function daHtml(html: string) {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim()
}
const pulito = (t: string) => t.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TESTO)
const kb = (n: number) => Math.max(1, Math.round(n / 1024))
function base64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const daBase64url = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/')

// info@: la mail grezza dalla sua cartella (IMAP, senza segnarla come letta).
async function sorgenteGC(r: Record<string, any>) {
  const password = Deno.env.get('GC_MAIL_PASSWORD')
  if (!password) throw new Error('manca la password della casella (GC_MAIL_PASSWORD)')
  const imap = new ImapFlow({ host: 'imap.mail.hostpoint.ch', port: 993, secure: true, auth: { user: IO, pass: password }, logger: false })
  await imap.connect()
  try {
    const lock = await imap.getMailboxLock(String(r.cartella_da || 'INBOX'), { readOnly: true })
    try {
      const mid = senzaParentesi(r.message_id)
      for (const uid of (await imap.search({ header: { 'message-id': mid } }, { uid: true })) || []) {
        const m = await imap.fetchOne(String(uid), { envelope: true, source: true }, { uid: true })
        if (m && senzaParentesi(m.envelope?.messageId || '') === mid && m.source) return m.source as Uint8Array
      }
      return null
    } finally {
      lock.release()
    }
  } finally {
    await imap.logout().catch(() => {})
  }
}
const indirizzi = (x: any) => (Array.isArray(x) ? x : x ? [x] : []).map((a: any) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ')

async function leggiGC(r: Record<string, any>) {
  const sorgente = await sorgenteGC(r)
  if (!sorgente) return { messaggi: [], avviso: 'La mail non è più in questa cartella.' }
  const m = await PostalMime.parse(sorgente)
  return { messaggi: [{
    da: indirizzi(m.from), a: indirizzi(m.to), data: m.date, oggetto: m.subject,
    testo: pulito(m.text || daHtml(m.html || '')),
    allegati: (m.attachments || []).map((x: any, i: number) => ({ rif: String(i), nome: x.filename || `allegato ${i + 1}`, tipo: x.mimeType, kb: kb(x.content?.byteLength || 0) })),
  }] }
}
async function allegatoGC(r: Record<string, any>, rif: string) {
  const sorgente = await sorgenteGC(r)
  if (!sorgente) throw new Error('La mail non è più in questa cartella')
  const x = (await PostalMime.parse(sorgente)).attachments?.[Number(rif)]
  if (!x) throw new Error('Allegato non trovato')
  const bytes = new Uint8Array(x.content as ArrayBuffer)
  if (bytes.length > MAX_ALLEGATO) throw new Error('Allegato troppo grande: aprilo dalla casella')
  return { nome: x.filename || 'allegato', tipo: x.mimeType || 'application/octet-stream', dati: base64(bytes) }
}

// Gmail: gli ultimi 5 messaggi della conversazione, dal più vecchio al più nuovo (l'app li mostra col più nuovo in cima).
function parti(p: any): any[] { return [p, ...(p?.parts || []).flatMap(parti)] }
const decodifica = (d: string) => new TextDecoder().decode(Uint8Array.from(atob(daBase64url(d)), (c) => c.charCodeAt(0)))
async function leggiCeramex(r: Record<string, any>) {
  const token = await accessoGmail()
  const thread = r.gmail_thread_id && await gmail(token, `threads/${r.gmail_thread_id}?format=full`)
  if (!thread) return { messaggi: [], avviso: 'La conversazione non c\'è più in Gmail.' }
  const messaggi = (thread.messages || []).slice(-5).map((m: any) => {
    const h = (n: string) => (m.payload?.headers || []).find((x: any) => x.name.toLowerCase() === n)?.value || ''
    const tutte = parti(m.payload)
    const piano = tutte.find((p) => p.mimeType === 'text/plain' && p.body?.data && !p.filename)
    const html = tutte.find((p) => p.mimeType === 'text/html' && p.body?.data && !p.filename)
    return {
      da: h('from'), a: h('to'), data: h('date'), oggetto: h('subject'),
      testo: pulito(piano ? decodifica(piano.body.data) : html ? daHtml(decodifica(html.body.data)) : m.snippet || ''),
      allegati: tutte.filter((p) => p.filename && p.body?.attachmentId)
        .map((p) => ({ rif: `${m.id}/${p.body.attachmentId}`, nome: p.filename, tipo: p.mimeType, kb: kb(p.body.size || 0) })),
    }
  })
  return { messaggi }
}
async function allegatoCeramex(r: Record<string, any>, rif: string) {
  const [mid, aid] = rif.split('/')
  const token = await accessoGmail()
  const thread = await gmail(token, `threads/${r.gmail_thread_id}?format=full`)
  const p = (thread?.messages || []).filter((m: any) => m.id === mid).flatMap((m: any) => parti(m.payload)).find((x: any) => x.body?.attachmentId === aid)
  if (!p) throw new Error('Allegato non trovato')
  if ((p.body.size || 0) > MAX_ALLEGATO) throw new Error('Allegato troppo grande: aprilo da Gmail')
  const a = await gmail(token, `messages/${mid}/attachments/${encodeURIComponent(aid)}`)
  return { nome: p.filename, tipo: p.mimeType || 'application/octet-stream', dati: daBase64url(a.data) }
}

// --- Rispondere e inoltrare (13.10.2026 sera) ---
const IO_CERAMEX = 'giovannifabris@ceramex.ch'
const MAX_ALLEGATI = 20 * 1024 * 1024
const pulisciIndirizzi = (l: unknown[]) => [...new Set(l.map((x) => String(x || '').trim().toLowerCase())
  .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))]
const soloIndirizzi = (s: string) => (s.match(/[^\s<>",;]+@[^\s<>",;]+/g) || [])
const conParentesi = (id: string) => `<${senzaParentesi(id)}>`
const conPrefisso = (ogg: string, tipo: 'rispondi' | 'inoltra') => {
  const o = (ogg || '').trim()
  if (tipo === 'rispondi') return /^(re|aw|r|sv|antw)\s*:/i.test(o) ? o : `Re: ${o}`
  return /^(fwd?|wg|i|tr|rv)\s*:/i.test(o) ? o : `Fwd: ${o}`
}
const quandoMail = (d: unknown) => {
  const x = new Date(String(d || ''))
  return isNaN(x.getTime()) ? String(d || '') : x.toLocaleString('it-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// La mail di partenza, uguale per le due caselle.
type Originale = {
  messageId: string, references: string[], da: string, daIndirizzo: string, rispondiA: string[], a: string[], cc: string[],
  oggetto: string, data: unknown, testo: string, allegati: { filename: string, contentType: string, content: Uint8Array }[], threadId?: string,
}

async function originaleGC(r: Record<string, any>, conAllegati: boolean): Promise<Originale | null> {
  const sorgente = await sorgenteGC(r)
  if (!sorgente) return null
  const m = await PostalMime.parse(sorgente)
  const lista = (x: any) => (Array.isArray(x) ? x : x ? [x] : []).map((a: any) => a.address).filter(Boolean)
  return {
    messageId: m.messageId || r.message_id, references: String(m.references || '').match(/<[^>]+>/g) || [],
    da: indirizzi(m.from), daIndirizzo: m.from?.address || '', rispondiA: lista(m.replyTo), a: lista(m.to), cc: lista(m.cc),
    oggetto: m.subject || r.oggetto || '', data: m.date, testo: pulito(m.text || daHtml(m.html || '')),
    allegati: conAllegati ? (m.attachments || []).map((x: any, i: number) => ({ filename: x.filename || `allegato ${i + 1}`,
      contentType: x.mimeType || 'application/octet-stream', content: new Uint8Array(x.content as ArrayBuffer) })) : [],
  }
}

async function originaleCeramex(token: string, r: Record<string, any>, conAllegati: boolean): Promise<Originale | null> {
  const thread = r.gmail_thread_id && await gmail(token, `threads/${r.gmail_thread_id}?format=full`)
  const vere = (thread?.messages || []).filter((m: any) => !(m.labelIds || []).includes('DRAFT'))
  if (!vere.length) return null
  const h = (m: any, n: string) => (m.payload?.headers || []).find((x: any) => x.name.toLowerCase() === n)?.value || ''
  const mio = (m: any) => soloIndirizzi(h(m, 'from')).some((x) => x.toLowerCase() === IO_CERAMEX)
  // Si risponde all'ultimo messaggio arrivato (se sono tutti suoi, all'ultimo).
  const m = [...vere].reverse().find((x: any) => !mio(x)) || vere[vere.length - 1]
  const tutte = parti(m.payload)
  const piano = tutte.find((p) => p.mimeType === 'text/plain' && p.body?.data && !p.filename)
  const html = tutte.find((p) => p.mimeType === 'text/html' && p.body?.data && !p.filename)
  let allegati: Originale['allegati'] = []
  if (conAllegati) {
    // Gli allegati del messaggio; se non ne ha, quelli del messaggio più recente che li ha.
    const conFile = [m, ...[...vere].reverse()].find((x: any) => parti(x.payload).some((p) => p.filename && p.body?.attachmentId))
    for (const p of conFile ? parti(conFile.payload).filter((p) => p.filename && p.body?.attachmentId) : []) {
      const a = await gmail(token, `messages/${conFile.id}/attachments/${encodeURIComponent(p.body.attachmentId)}`)
      allegati.push({ filename: p.filename, contentType: p.mimeType || 'application/octet-stream',
        content: Uint8Array.from(atob(daBase64url(a.data)), (c) => c.charCodeAt(0)) })
    }
  }
  return {
    messageId: h(m, 'message-id'), references: h(m, 'references').match(/<[^>]+>/g) || [],
    da: h(m, 'from'), daIndirizzo: soloIndirizzi(h(m, 'from'))[0] || '', rispondiA: soloIndirizzi(h(m, 'reply-to')),
    a: soloIndirizzi(h(m, 'to')), cc: soloIndirizzi(h(m, 'cc')), oggetto: h(m, 'subject') || r.oggetto || '', data: h(m, 'date'),
    testo: pulito(piano ? decodifica(piano.body.data) : html ? daHtml(decodifica(html.body.data)) : m.snippet || ''),
    allegati, threadId: thread.id,
  }
}

function prepara(o: Originale, io: string, tipo: 'rispondi' | 'inoltra', corpo: { testo?: string, tutti?: boolean, a?: unknown[] }) {
  const testo = String(corpo.testo || '').trim()
  if (!testo) throw new Error('Scrivi il testo')
  let a: string[], cc: string[] = []
  if (tipo === 'rispondi') {
    const daLui = o.daIndirizzo.toLowerCase() === io
    a = pulisciIndirizzi(daLui ? o.a : (o.rispondiA.length ? o.rispondiA : [o.daIndirizzo])).filter((x) => x !== io)
    if (corpo.tutti) cc = pulisciIndirizzi([...o.a, ...o.cc]).filter((x) => x !== io && !a.includes(x))
  } else {
    a = pulisciIndirizzi(Array.isArray(corpo.a) ? corpo.a : [])
    if (!a.length) throw new Error('Scrivi a chi inoltrarla')
  }
  if (!a.length) throw new Error('Non trovo a chi rispondere')
  const sotto = tipo === 'rispondi'
    ? `Il ${quandoMail(o.data)}, ${o.da} ha scritto:\n${o.testo.split('\n').map((l) => `> ${l}`).join('\n')}`
    : ['---------- Messaggio inoltrato ----------', `Da: ${o.da}`, `Data: ${quandoMail(o.data)}`, `Oggetto: ${o.oggetto}`,
      `A: ${o.a.join(', ')}`, ...(o.cc.length ? [`Cc: ${o.cc.join(', ')}`] : []), '', o.testo].join('\n')
  const allegati = tipo === 'inoltra' ? o.allegati : []
  if (allegati.reduce((s, x) => s + x.content.byteLength, 0) > MAX_ALLEGATI) throw new Error('Allegati troppo grandi (oltre 20 MB): inoltrala dalla casella')
  const riferimenti = o.messageId ? [...o.references, conParentesi(o.messageId)] : o.references
  return {
    a, cc, oggetto: conPrefisso(o.oggetto, tipo), testo: `${testo}\n\n${sotto}`, allegati,
    ...(tipo === 'rispondi' && o.messageId ? { inReplyTo: conParentesi(o.messageId), references: riferimenti.join(' ') } : {}),
  }
}

async function mandaGC(m: ReturnType<typeof prepara>) {
  const password = Deno.env.get('GC_MAIL_PASSWORD')
  if (!password) throw new Error('manca la password della casella (GC_MAIL_PASSWORD)')
  const grezza: Uint8Array = await new MailComposer({
    from: { name: 'G&C Home concepts', address: IO }, to: m.a, cc: m.cc.length ? m.cc : undefined, subject: m.oggetto, text: m.testo,
    messageId: `<${crypto.randomUUID()}@homeconcepts.ch>`, date: new Date(), inReplyTo: m.inReplyTo, references: m.references,
    attachments: m.allegati.map((x) => ({ filename: x.filename, contentType: x.contentType, content: x.content })),
  }).compile().build()
  const smtp = nodemailer.createTransport({ host: 'asmtp.mail.hostpoint.ch', port: 465, secure: true,
    auth: { user: IO, pass: password }, connectionTimeout: 20000, socketTimeout: 60000 })
  await smtp.sendMail({ envelope: { from: IO, to: [...m.a, ...m.cc] }, raw: grezza })
  // Copia in "Sent" (se non riesce, la mail è comunque partita): la legge poi posta-gc.
  try {
    const imap = new ImapFlow({ host: 'imap.mail.hostpoint.ch', port: 993, secure: true, auth: { user: IO, pass: password }, logger: false })
    await imap.connect()
    await imap.append('Sent', grezza, ['\\Seen'])
    await imap.logout()
    return true
  } catch (_) { return false }
}

async function mandaCeramex(token: string, m: ReturnType<typeof prepara>, threadId?: string) {
  const grezza: Uint8Array = await new MailComposer({
    from: { name: 'Giovanni Fabris', address: IO_CERAMEX }, to: m.a, cc: m.cc.length ? m.cc : undefined, subject: m.oggetto, text: m.testo,
    date: new Date(), inReplyTo: m.inReplyTo, references: m.references,
    attachments: m.allegati.map((x) => ({ filename: x.filename, contentType: x.contentType, content: x.content })),
  }).compile().build()
  // Caricamento "multipart": regge anche gli allegati grandi e tiene la risposta nella stessa conversazione.
  const confine = `sb${crypto.randomUUID()}`
  const enc = new TextEncoder()
  const testa = enc.encode(`--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(m.inReplyTo && threadId ? { threadId } : {})}\r\n--${confine}\r\nContent-Type: message/rfc822\r\n\r\n`)
  const coda = enc.encode(`\r\n--${confine}--`)
  const corpo = new Uint8Array(testa.length + grezza.length + coda.length)
  corpo.set(testa); corpo.set(grezza, testa.length); corpo.set(coda, testa.length + grezza.length)
  const r = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${confine}` }, body: corpo,
  })
  if (r.status === 403) throw new Error('Gmail non dà il permesso di mandare: va rifatto il collegamento dal PC')
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

async function rispondiOInoltra(r: Record<string, any>, tipo: 'rispondi' | 'inoltra', corpo: Record<string, any>) {
  const ceramex = (r.casella || 'gc') === 'ceramex'
  const token = ceramex ? await accessoGmail() : ''
  const conAllegati = tipo === 'inoltra'
  const o = ceramex ? await originaleCeramex(token, r, conAllegati) : await originaleGC(r, conAllegati)
  if (!o) throw new Error(ceramex ? 'La conversazione non c\'è più in Gmail' : 'La mail non è più in questa cartella')
  const m = prepara(o, ceramex ? IO_CERAMEX : IO, tipo, corpo)
  const riassunto = { a: m.a, cc: m.cc, oggetto: m.oggetto, allegati: m.allegati.map((x) => x.filename) }
  if (corpo.prova) return { prova: true, ...riassunto, testo: m.testo.slice(0, 1500) }

  // Blocco: niente doppio invio se si tocca due volte (2 minuti).
  const prima = new Date(Date.now() - 120e3).toISOString()
  const presa = await rest(`riordino_mail?id=eq.${r.id}&or=(esito.is.null,esito.not.like.Invio in corso*,aggiornata_il.lt.${prima})`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ esito: 'Invio in corso', aggiornata_il: new Date().toISOString() }) }) as unknown[]
  if (!presa?.length) throw new Error('Sto già mandando questa mail: aspetta un momento')
  try {
    const copia = ceramex ? (await mandaCeramex(token, m, o.threadId), true) : await mandaGC(m)
    const ora = new Date().toLocaleString('it-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const esito = tipo === 'rispondi' ? `Risposta mandata il ${ora}` : `Inoltrata a ${m.a.join(', ')} il ${ora}`
    await aggiorna(r.id, { esito: copia ? esito : `${esito} (copia in "Inviata" non riuscita)` })
    return { ok: true, esito, ...riassunto }
  } catch (e) {
    await aggiorna(r.id, { esito: r.esito ?? null })
    throw e
  }
}

type Esito = { spostate: number, sparite: number, errori: string[] }

async function spostaCeramex(righe: Record<string, any>[], scelte: Map<string, string | undefined>, esito: Esito) {
  const token = await accessoGmail()
  const etichette = new Map((await etichetteUtente(token)).map((l) => [l.name, l.id]))
  for (const r of righe) {
    const indietro = r.stato
    try {
      const dest = (scelte.get(r.id) || r.cartella_proposta || '').trim()
      if (!dest) throw new Error('manca l\'etichetta')
      let id = etichette.get(dest)
      if (!id) {
        // Etichetta nuova: solo quella proposta dall'agente con ✚ (approvata spuntando la mail).
        if (!(r.nuova && dest === (r.cartella_proposta || '').trim())) throw new Error(`l'etichetta "${dest}" non esiste`)
        id = (await gmail(token, 'labels', { method: 'POST', body: JSON.stringify({ name: dest, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) })).id as string
        etichette.set(dest, id)
      }
      const thread = r.gmail_thread_id && await gmail(token, `threads/${r.gmail_thread_id}?format=minimal`)
      const inArrivo = (thread?.messages || []).some((m: any) => (m.labelIds || []).includes('INBOX'))
      if (!inArrivo) {
        await aggiorna(r.id, { stato: 'sparita', esito: 'Non è più nella Posta in arrivo' })
        esito.sparite++
        continue
      }
      // Tutta la conversazione, come "Sposta in" di Gmail: etichetta messa e fuori dalla Posta in arrivo.
      await gmail(token, `threads/${r.gmail_thread_id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: [id], removeLabelIds: ['INBOX'] }) })
      await aggiorna(r.id, { stato: 'spostata', cartella_finale: dest, spostata_il: new Date().toISOString(), esito: 'ok' })
      esito.spostate++
    } catch (e) {
      const msg = String((e as Error)?.message || e).slice(0, 200)
      await aggiorna(r.id, { stato: indietro, esito: `Non spostata: ${msg}` })
      esito.errori.push(`${r.oggetto || 'mail'}: ${msg}`)
    }
  }
}

// --- Hostpoint info@ (cartelle IMAP) ---
async function spostaGC(righe: Record<string, any>[], scelte: Map<string, string | undefined>, esito: Esito) {
  const password = Deno.env.get('GC_MAIL_PASSWORD')
  if (!password) throw new Error('manca la password della casella (GC_MAIL_PASSWORD)')
  const imap = new ImapFlow({ host: 'imap.mail.hostpoint.ch', port: 993, secure: true, auth: { user: IO, pass: password }, logger: false })
  await imap.connect()
  const esistenti = new Set((await imap.list()).map((b) => b.path))
  // Di solito INBOX e Sent; anche altre cartelle quando Giovanni chiede di spostare una mail già archiviata (13.10.2026).
  for (const da of new Set(righe.map((r) => String(r.cartella_da || 'INBOX')))) {
    const gruppo = righe.filter((r) => String(r.cartella_da || 'INBOX') === da)
    if (!esistenti.has(da)) {
      for (const r of gruppo) {
        await aggiorna(r.id, { stato: r.stato, esito: `Non spostata: la cartella "${da}" non esiste` })
        esito.errori.push(`${r.oggetto || r.message_id}: la cartella "${da}" non esiste`)
      }
      continue
    }
    const lock = await imap.getMailboxLock(da)
    try {
      for (const r of gruppo) {
        const indietro = r.stato // 'proposta' o 'tenere'
        try {
          const dest = inChiaro(scelte.get(r.id) || r.cartella_proposta || '')
          if (!dest) throw new Error('manca la cartella')
          if (!esistenti.has(dest)) {
            // Cartella nuova: solo quella proposta dall'agente con ✚ (approvata spuntando la mail).
            if (!(r.nuova && dest === inChiaro(r.cartella_proposta || ''))) throw new Error(`la cartella "${dest}" non esiste`)
            await imap.mailboxCreate(dest)
            esistenti.add(dest)
          }
          const mid = senzaParentesi(r.message_id)
          const trovate = (await imap.search({ header: { 'message-id': mid } }, { uid: true })) || []
          // Controllo che sia proprio quella mail (la ricerca IMAP trova anche pezzi di testo).
          const giuste: number[] = []
          for (const uid of trovate) {
            const m = await imap.fetchOne(String(uid), { envelope: true }, { uid: true })
            if (m && senzaParentesi(m.envelope?.messageId || '') === mid) giuste.push(uid)
          }
          if (!giuste.length) {
            await aggiorna(r.id, { stato: 'sparita', esito: `Non è più in ${da === 'INBOX' ? 'Posta in arrivo' : da === 'Sent' ? 'Posta inviata' : da}` })
            esito.sparite++
            continue
          }
          await imap.messageMove(giuste.join(','), dest, { uid: true })
          await aggiorna(r.id, { stato: 'spostata', cartella_finale: dest, spostata_il: new Date().toISOString(), esito: 'ok' })
          esito.spostate++
        } catch (e) {
          const msg = String((e as Error)?.message || e).slice(0, 200)
          await aggiorna(r.id, { stato: indietro, esito: `Non spostata: ${msg}` })
          esito.errori.push(`${r.oggetto || r.message_id}: ${msg}`)
        }
      }
    } finally {
      lock.release()
    }
  }
  await imap.logout()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  const corpo = await req.json().catch(() => ({}))
  const { azione, voci, casella, id, rif } = corpo

  // Solo Giovanni. Col token della copia solo le prove di "rispondi"/"inoltra" (non manda niente).
  const copia = Deno.env.get('COPIA_TOKEN')
  const prova = !!copia && req.headers.get('x-copia-token') === copia && corpo.prova === true && ['rispondi', 'inoltra'].includes(azione)
  if (!prova) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
    const utente = u.ok ? await u.json() : null
    if (utente?.id !== UTENTE) return risposta({ errore: 'Non autorizzato' }, 401)
  }

  if (azione === 'rispondi' || azione === 'inoltra') {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) return risposta({ errore: 'Mail sconosciuta' }, 400)
    const [r] = await rest(`riordino_mail?id=eq.${id}&select=*`) as Record<string, any>[]
    if (!r) return risposta({ errore: 'Mail sconosciuta' }, 404)
    try {
      return risposta(await rispondiOInoltra(r, azione, corpo))
    } catch (e) {
      return risposta({ errore: String((e as Error)?.message || e).slice(0, 300) }, 502)
    }
  }

  if (azione === 'leggi' || azione === 'allegato') {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) return risposta({ errore: 'Mail sconosciuta' }, 400)
    const [r] = await rest(`riordino_mail?id=eq.${id}&select=*`) as Record<string, any>[]
    if (!r) return risposta({ errore: 'Mail sconosciuta' }, 404)
    const ceramex = (r.casella || 'gc') === 'ceramex'
    try {
      if (azione === 'leggi') return risposta(ceramex ? await leggiCeramex(r) : await leggiGC(r))
      return risposta(ceramex ? await allegatoCeramex(r, String(rif)) : await allegatoGC(r, String(rif)))
    } catch (e) {
      return risposta({ errore: String((e as Error)?.message || e).slice(0, 200) }, 502)
    }
  }

  if (azione === 'cartelle') {
    if (casella === 'ceramex') {
      try {
        const nomi = (await etichetteUtente(await accessoGmail())).map((l) => l.name).sort((a, b) => a.localeCompare(b, 'it'))
        return risposta({ cartelle: nomi })
      } catch (e) {
        return risposta({ errore: String((e as Error)?.message || e).slice(0, 200) }, 502)
      }
    }
    const righe = await rest('posta_stato?select=cartella&order=cartella') as { cartella: string }[]
    return risposta({ cartelle: righe.map((r) => r.cartella).filter((c) => c !== 'INBOX' && c !== 'Sent') })
  }
  if (azione !== 'sposta') return risposta({ errore: 'Azione sconosciuta' }, 400)
  if (!Array.isArray(voci) || !voci.length) return risposta({ errore: 'Nessuna mail scelta' }, 400)
  if (voci.length > MASSIMO) return risposta({ errore: `Al massimo ${MASSIMO} mail per volta` }, 400)

  const scelte = new Map<string, string | undefined>(voci.map((v: { id: string, cartella?: string }) => [String(v.id), v.cartella]))
  const ids = [...scelte.keys()].filter((id) => /^[0-9a-f-]{36}$/.test(id))
  const righe = await rest(`riordino_mail?id=in.(${ids.join(',')})&stato=in.(proposta,tenere)&select=*`) as Record<string, any>[]
  if (!righe.length) return risposta({ errore: 'Queste mail sono già state spostate o non ci sono più' }, 409)

  // Blocco subito le righe: niente doppi spostamenti se si tocca due volte.
  for (const r of righe) await aggiorna(r.id, { stato: 'in_spostamento' })

  const esito: Esito = { spostate: 0, sparite: 0, errori: [] }
  for (const [nome, fai] of [['gc', spostaGC], ['ceramex', spostaCeramex]] as const) {
    const gruppo = righe.filter((r) => (r.casella || 'gc') === nome)
    if (!gruppo.length) continue
    try {
      await fai(gruppo, scelte, esito)
    } catch (e) {
      // Casella non raggiungibile: le righe rimaste bloccate tornano com'erano.
      const msg = String((e as Error)?.message || e).slice(0, 200)
      for (const r of gruppo) {
        await rest(`riordino_mail?id=eq.${r.id}&stato=eq.in_spostamento`, { method: 'PATCH',
          headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stato: r.stato, esito: `Non spostata: ${msg}` }) })
      }
      esito.errori.push(`${nome === 'gc' ? 'Casella info@' : 'Gmail Ceramex'}: ${msg}`)
    }
  }
  return risposta({ ok: true, ...esito })
})