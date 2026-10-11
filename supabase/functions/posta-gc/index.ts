// Legge la casella info@homeconcepts.ch (IMAP Hostpoint) e salva le mail nel second brain (fase 5).
// La chiama pg_cron ogni 5 minuti. Apre le cartelle in SOLA LETTURA: non segna niente come letto,
// non sposta e non cancella. Poi allinea le conversazioni e annulla le bozze superate
// (qualcuno ha già risposto o è arrivata una mail nuova nella stessa conversazione).
// Storico: a ogni giro legge anche un pezzo di mail vecchie (scendendo), finché arriva all'inizio.
import { ImapFlow } from 'npm:imapflow@1.0.171'
import PostalMime from 'npm:postal-mime@2.4.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const IO = 'info@homeconcepts.ch'
const CARTELLE: [string, 'arrivata' | 'inviata'][] = [['INBOX', 'arrivata'], ['Sent', 'inviata']]
const PEZZO_NUOVE = 150    // mail nuove per cartella e per giro
const PEZZO_STORICO = 120  // mail vecchie per cartella e per giro
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
const indirizzi = (l?: { address?: string, group?: { address?: string }[] }[]) =>
  (l || []).flatMap((a) => a.group ? a.group.map(indirizzo) : [indirizzo(a)]).filter(Boolean)

// Testo leggibile: il testo semplice, altrimenti l'HTML ripulito.
function testoDa(m: { text?: string, html?: string }) {
  if (m.text?.trim()) return m.text
  return (m.html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
}

async function riga(uid: number, sorgente: Uint8Array, cartella: 'arrivata' | 'inviata') {
  const m = await PostalMime.parse(sorgente)
  const header = (n: string) => m.headers.find((h) => h.key === n)?.value
  const id = pulisciId(m.messageId) || `uid-${cartella}-${uid}@${IO}`
  const rif = listaId(header('references'))
  const risponde = listaId(m.inReplyTo || header('in-reply-to'))[0] || null
  return {
    message_id: id, utente_id: UTENTE, area: 'G', cartella,
    thread_key: rif[0] || risponde || id, in_reply_to: risponde, riferimenti: rif,
    da: indirizzo(m.from), da_nome: m.from?.name || null, a: indirizzi(m.to), cc: indirizzi(m.cc),
    oggetto: m.subject || null, data: m.date ? new Date(m.date).toISOString() : null,
    testo: testoDa(m).slice(0, 60000),
    allegati: (m.attachments || []).filter((a) => a.disposition !== 'inline' || a.filename)
      .map((a) => ({ nome: a.filename, tipo: a.mimeType, kb: Math.round(((a.content as ArrayBuffer)?.byteLength || 0) / 1024) })),
    fonte: 'imap', imap_uid: uid,
  }
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
        const righe = []
        for await (const msg of client.fetch(`${s.ultimo_uid + 1}:${fino}`, { uid: true, source: true }, { uid: true })) {
          try { righe.push(await riga(msg.uid, msg.source, tipo)) } catch (_) { /* mail illeggibile: si salta */ }
        }
        await salva(righe)
        nuove = righe.length
        s.ultimo_uid = fino
      }

      // 2) Un pezzo di storico, se c'è tempo.
      if (s.storico_uid && s.storico_uid > 0 && Date.now() - inizio < LIMITE_MS / 2) {
        const da = Math.max(1, s.storico_uid - PEZZO_STORICO + 1)
        const righe = []
        for await (const msg of client.fetch(`${da}:${s.storico_uid}`, { uid: true, source: true }, { uid: true })) {
          try { righe.push(await riga(msg.uid, msg.source, tipo)) } catch (_) { /* si salta */ }
          if (Date.now() - inizio > LIMITE_MS) break
        }
        await salva(righe)
        vecchie = righe.length
        s.storico_uid = da === 1 ? 0 : da - 1
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
