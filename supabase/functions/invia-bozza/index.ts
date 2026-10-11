// Invia una bozza approvata da Giovanni nell'app (fase 5).
// Parte da info@homeconcepts.ch (SMTP Hostpoint) come risposta nella stessa conversazione,
// e la copia va nella cartella "Sent" della casella, come se l'avesse scritta dal programma mail.
// La chiama solo l'app, con l'accesso di Giovanni. Prima di inviare ricontrolla che nessuno
// abbia già risposto nel frattempo.
import nodemailer from 'npm:nodemailer@6.9.16'
import MailComposer from 'npm:nodemailer@6.9.16/lib/mail-composer/index.js'
import { ImapFlow } from 'npm:imapflow@1.0.171'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const IO = Deno.env.get('GC_MAIL_USER') || 'info@homeconcepts.ch'
const MITTENTE = { name: 'G&C Home concepts', address: IO }

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
  rest(`bozze?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })

const pulisci = (l?: string[] | null) => [...new Set((l || []).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))]
const conParentesi = (id: string) => `<${id}>`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  // Solo Giovanni.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
  const utente = u.ok ? await u.json() : null
  if (utente?.id !== UTENTE) return risposta({ errore: 'Non autorizzato' }, 401)

  const { id, testo, a, cc, oggetto } = await req.json().catch(() => ({}))
  if (!id) return risposta({ errore: 'Manca la bozza' }, 400)
  const [b] = await rest(`bozze?id=eq.${id}&select=*`) as Record<string, any>[]
  if (!b) return risposta({ errore: 'Bozza non trovata' }, 404)
  if (b.stato !== 'proposta') {
    return risposta({ errore: b.stato === 'annullata' ? `Bozza annullata: ${b.motivo_annullata || 'qualcuno ha già risposto'}` : `La bozza è già ${b.stato}` }, 409)
  }

  const password = Deno.env.get('GC_MAIL_PASSWORD')
  if (!password) return risposta({ errore: 'Manca la password della casella (GC_MAIL_PASSWORD)' }, 500)

  // Mail a cui si risponde: per i riferimenti della conversazione.
  let originale: Record<string, any> | null = null
  if (b.posta_id) [originale] = await rest(`posta?id=eq.${b.posta_id}&select=message_id,riferimenti,thread_key,oggetto,data`) as Record<string, any>[]

  // Qualcuno ha già risposto nel frattempo? (posta-gc lo controlla ogni 5 minuti, qui si ricontrolla subito)
  if (b.thread_key) {
    const dopo = await rest(`posta?thread_key=eq.${encodeURIComponent(b.thread_key)}&data=gt.${encodeURIComponent(b.creata_il)}&select=id,cartella,data&order=data&limit=1`) as Record<string, any>[]
    const altro = dopo.filter((p) => p.id !== b.posta_id)[0]
    if (altro) {
      await aggiorna(id, { stato: 'annullata', annullata_il: new Date().toISOString(),
        motivo_annullata: altro.cartella === 'inviata' ? 'Qualcuno ha già risposto da info@' : 'È arrivata una mail nuova nella conversazione' })
      return risposta({ errore: 'Nel frattempo qualcuno ha già risposto: bozza annullata.' }, 409)
    }
  }

  const destinatari = pulisci(a?.length ? a : b.a)
  const copia = pulisci(cc ?? b.cc).filter((x) => !destinatari.includes(x) && x !== IO)
  if (!destinatari.length) return risposta({ errore: 'Manca il destinatario' }, 400)
  const corpo = String(testo ?? b.testo ?? '').trim()
  if (!corpo) return risposta({ errore: 'Il testo è vuoto' }, 400)
  const ogg = String(oggetto ?? b.oggetto ?? '').trim()

  // Blocco subito la bozza: niente doppi invii se si tocca due volte.
  await rest(`bozze?id=eq.${id}&stato=eq.proposta`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ stato: 'in_invio', testo: corpo, a: destinatari, cc: copia, oggetto: ogg }) })

  const riferimenti = originale ? [...(originale.riferimenti || []), originale.message_id] : []
  const messageId = `${crypto.randomUUID()}@homeconcepts.ch`
  const mail = {
    from: MITTENTE, to: destinatari, cc: copia.length ? copia : undefined, subject: ogg, text: corpo,
    messageId: conParentesi(messageId), date: new Date(),
    ...(originale ? { inReplyTo: conParentesi(originale.message_id), references: riferimenti.map(conParentesi).join(' ') } : {}),
  }

  try {
    const grezza: Uint8Array = await new MailComposer(mail).compile().build()
    const smtp = nodemailer.createTransport({
      host: 'asmtp.mail.hostpoint.ch', port: 465, secure: true,
      auth: { user: IO, pass: password }, connectionTimeout: 20000, socketTimeout: 40000,
    })
    await smtp.sendMail({ envelope: { from: IO, to: [...destinatari, ...copia] }, raw: grezza })

    // Copia in "Sent" (se non riesce, la mail è comunque partita).
    let copiaInviata = true
    try {
      const imap = new ImapFlow({ host: 'imap.mail.hostpoint.ch', port: 993, secure: true, auth: { user: IO, pass: password }, logger: false })
      await imap.connect()
      await imap.append('Sent', grezza, ['\\Seen'])
      await imap.logout()
    } catch (_) { copiaInviata = false }

    const ora = new Date().toISOString()
    await aggiorna(id, { stato: 'inviata', inviata_il: ora, inviata_message_id: messageId, errore: copiaInviata ? null : 'Inviata, ma la copia in "Inviata" non è riuscita' })
    await rest('posta?on_conflict=message_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ message_id: messageId, utente_id: UTENTE, area: 'G', cartella: 'inviata', thread_key: b.thread_key || messageId,
        in_reply_to: originale?.message_id || null, riferimenti, da: IO, da_nome: MITTENTE.name, a: destinatari, cc: copia,
        oggetto: ogg, data: ora, testo: corpo, azienda_id: b.azienda_id, fonte: 'imap', vista_il: ora, esito: 'niente', motivo: 'risposta approvata da Giovanni' }) })
    return risposta({ ok: true, inviata_il: ora })
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    await aggiorna(id, { stato: 'proposta', errore: `Invio non riuscito: ${errore}` })
    return risposta({ errore: `Invio non riuscito: ${errore}` }, 502)
  }
})
