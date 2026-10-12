// Riordino della casella info@homeconcepts.ch (12.10.2026 sera, ok di Giovanni).
// L'agente propone la cartella (tabella riordino_mail); Giovanni spunta nell'app e preme "Sposta":
// questa funzione sposta SOLO le mail scelte da lui (IMAP MOVE su Hostpoint). Non cancella e non invia niente.
// Crea una cartella solo se è la cartella nuova proposta dall'agente (✚) e Giovanni l'ha approvata.
// Azioni: { azione: 'cartelle' } → cartelle della casella (dall'ultima lettura di posta-gc);
//         { azione: 'sposta', voci: [{ id, cartella? }] } → sposta (cartella = correzione di Giovanni).
import { ImapFlow } from 'npm:imapflow@1.0.171'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  // Solo Giovanni.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
  const utente = u.ok ? await u.json() : null
  if (utente?.id !== UTENTE) return risposta({ errore: 'Non autorizzato' }, 401)

  const { azione, voci } = await req.json().catch(() => ({}))

  if (azione === 'cartelle') {
    const righe = await rest('posta_stato?select=cartella&order=cartella') as { cartella: string }[]
    return risposta({ cartelle: righe.map((r) => r.cartella).filter((c) => c !== 'INBOX' && c !== 'Sent') })
  }
  if (azione !== 'sposta') return risposta({ errore: 'Azione sconosciuta' }, 400)
  if (!Array.isArray(voci) || !voci.length) return risposta({ errore: 'Nessuna mail scelta' }, 400)
  if (voci.length > MASSIMO) return risposta({ errore: `Al massimo ${MASSIMO} mail per volta` }, 400)

  const password = Deno.env.get('GC_MAIL_PASSWORD')
  if (!password) return risposta({ errore: 'Manca la password della casella (GC_MAIL_PASSWORD)' }, 500)

  const scelte = new Map<string, string | undefined>(voci.map((v: { id: string, cartella?: string }) => [String(v.id), v.cartella]))
  const ids = [...scelte.keys()].filter((id) => /^[0-9a-f-]{36}$/.test(id))
  const righe = await rest(`riordino_mail?id=in.(${ids.join(',')})&stato=in.(proposta,tenere)&select=*`) as Record<string, any>[]
  if (!righe.length) return risposta({ errore: 'Queste mail sono già state spostate o non ci sono più' }, 409)

  // Blocco subito le righe: niente doppi spostamenti se si tocca due volte.
  for (const r of righe) await aggiorna(r.id, { stato: 'in_spostamento' })

  const esito = { spostate: 0, sparite: 0, errori: [] as string[] }
  const imap = new ImapFlow({ host: 'imap.mail.hostpoint.ch', port: 993, secure: true, auth: { user: IO, pass: password }, logger: false })
  try {
    await imap.connect()
    const esistenti = new Set((await imap.list()).map((b) => b.path))
    for (const da of ['INBOX', 'Sent']) {
      const gruppo = righe.filter((r) => r.cartella_da === da)
      if (!gruppo.length) continue
      const lock = await imap.getMailboxLock(da)
      try {
        for (const r of gruppo) {
          const indietro = r.stato // 'proposta' o 'tenere'
          try {
            const scelta = scelte.get(r.id)
            const dest = inChiaro(scelta || r.cartella_proposta || '')
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
              await aggiorna(r.id, { stato: 'sparita', esito: `Non è più in ${da === 'INBOX' ? 'Posta in arrivo' : 'Posta inviata'}` })
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
  } catch (e) {
    // Casella non raggiungibile: le righe rimaste bloccate tornano com'erano.
    const msg = String((e as Error)?.message || e).slice(0, 200)
    for (const r of righe) {
      await rest(`riordino_mail?id=eq.${r.id}&stato=eq.in_spostamento`, { method: 'PATCH',
        headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ stato: r.stato, esito: `Non spostata: ${msg}` }) })
    }
    return risposta({ errore: `Casella non raggiungibile: ${msg}`, ...esito }, 502)
  }
  return risposta({ ok: true, ...esito })
})
