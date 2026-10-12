// Riordino delle caselle: info@homeconcepts.ch (Hostpoint, cartelle) dal 12.10.2026 sera e Gmail Ceramex (etichette)
// dal 12.10.2026 notte, ok di Giovanni.
// L'agente propone la cartella (tabella riordino_mail); Giovanni spunta nell'app e preme "Sposta":
// questa funzione sposta SOLO le mail scelte da lui (IMAP MOVE su Hostpoint). Non cancella e non invia niente.
// Crea una cartella solo se è la cartella nuova proposta dall'agente (✚) e Giovanni l'ha approvata.
// Azioni: { azione: 'cartelle', casella? } → cartelle di info@ (dall'ultima lettura di posta-gc) o etichette Gmail;
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
  for (const da of ['INBOX', 'Sent']) {
    const gruppo = righe.filter((r) => r.cartella_da === da)
    if (!gruppo.length) continue
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
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  // Solo Giovanni.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
  const utente = u.ok ? await u.json() : null
  if (utente?.id !== UTENTE) return risposta({ errore: 'Non autorizzato' }, 401)

  const { azione, voci, casella } = await req.json().catch(() => ({}))

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