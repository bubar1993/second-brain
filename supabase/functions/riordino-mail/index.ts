// Riordino delle caselle: info@homeconcepts.ch (Hostpoint, cartelle) dal 12.10.2026 sera e Gmail Ceramex (etichette)
// dal 12.10.2026 notte, ok di Giovanni.
// L'agente propone la cartella (tabella riordino_mail); Giovanni spunta nell'app e preme "Sposta":
// questa funzione sposta SOLO le mail scelte da lui (IMAP MOVE su Hostpoint). Non cancella e non invia niente.
// Crea una cartella solo se è la cartella nuova proposta dall'agente (✚) e Giovanni l'ha approvata.
// Azioni: { azione: 'cartelle', casella? } → cartelle di info@ (dall'ultima lettura di posta-gc) o etichette Gmail;
//         { azione: 'sposta', voci: [{ id, cartella? }] } → sposta (cartella = correzione di Giovanni).
//         { azione: 'leggi', id } → testo della mail (info@) o degli ultimi messaggi della conversazione (Gmail), con gli allegati;
//         { azione: 'allegato', id, rif } → un allegato in base64 (13.10.2026, richiesta di Giovanni). Solo lettura: non segna come letta.
import { ImapFlow } from 'npm:imapflow@1.0.171'
import PostalMime from 'npm:postal-mime@2.4.3'

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

// Gmail: gli ultimi 5 messaggi della conversazione, dal più vecchio al più nuovo.
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

  // Solo Giovanni.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
  const utente = u.ok ? await u.json() : null
  if (utente?.id !== UTENTE) return risposta({ errore: 'Non autorizzato' }, 401)

  const { azione, voci, casella, id, rif } = await req.json().catch(() => ({}))

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