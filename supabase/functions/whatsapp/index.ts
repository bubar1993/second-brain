// WhatsApp (fase 7): qui Meta manda i messaggi del numero WhatsApp Business di Giovanni.
// - GET: verifica del webhook (Meta manda hub.challenge, si risponde se la parola di controllo è giusta).
// - POST: messaggi ricevuti, messaggi scritti dal telefono (eco), stato dei messaggi mandati,
//   storico 6 mesi e contatti della rubrica (solo all'aggancio).
// Ogni POST è firmato da Meta con la chiave segreta dell'app (WA_APP_SECRET): senza firma giusta si scarta.
// I messaggi sono contenuto di estranei: qui si salvano e basta, l'agente li legge come dati.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}
const inserisci = (tabella: string, righe: unknown[], conflitto: string, unisci = false) => righe.length
  ? rest(`${tabella}?on_conflict=${conflitto}`, { method: 'POST',
      headers: { Prefer: `resolution=${unisci ? 'merge' : 'ignore'}-duplicates,return=minimal` }, body: JSON.stringify(righe) })
  : null

async function firmaGiusta(corpo: string, firma: string | null) {
  const segreto = Deno.env.get('WA_APP_SECRET')
  if (!segreto || !firma?.startsWith('sha256=')) return false
  const chiave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', chiave, new TextEncoder().encode(corpo)))
  const atteso = 'sha256=' + [...h].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (atteso.length !== firma.length) return false
  let diff = 0
  for (let i = 0; i < atteso.length; i++) diff |= atteso.charCodeAt(i) ^ firma.charCodeAt(i)
  return diff === 0
}

const soloCifre = (n?: string | null) => (n || '').replace(/\D/g, '')
const quando = (ts?: string | number) => new Date(Number(ts || 0) * 1000 || Date.now()).toISOString()

// Testo leggibile e dati del media di un messaggio WhatsApp.
function contenuto(m: Record<string, any>) {
  const t = m.type || 'text'
  const parte = m[t] || {}
  let testo: string | null = null
  if (t === 'text') testo = parte.body ?? null
  else if (t === 'reaction') testo = parte.emoji ? `Reazione ${parte.emoji}` : null
  else if (t === 'location') testo = `Posizione: ${[parte.name, parte.address, parte.latitude, parte.longitude].filter(Boolean).join(', ')}`
  else if (t === 'contacts') testo = `Contatto: ${(m.contacts || []).map((c: any) => c.name?.formatted_name).join(', ')}`
  else if (t === 'button') testo = parte.text ?? null
  else if (t === 'interactive') testo = parte.button_reply?.title || parte.list_reply?.title || null
  else testo = parte.caption ?? null
  const media = ['image', 'audio', 'video', 'document', 'sticker'].includes(t)
    ? { id: parte.id, mime: parte.mime_type, nome: parte.filename, vocale: parte.voice ?? undefined } : null
  return { tipo: t, testo, media, risponde_a: m.context?.id ?? null }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === Deno.env.get('WA_VERIFY_TOKEN')
    return ok ? new Response(url.searchParams.get('hub.challenge') || '') : new Response('no', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('no', { status: 405 })

  const corpo = await req.text()
  if (!(await firmaGiusta(corpo, req.headers.get('x-hub-signature-256')))) return new Response('firma', { status: 401 })

  let dati: Record<string, any>
  try { dati = JSON.parse(corpo) } catch { return new Response('ok') }

  const [col] = await rest('wa_collegamento?id=eq.1&select=numero') as { numero: string | null }[] || []
  const mio = soloCifre(col?.numero)
  const contatti = new Map<string, Record<string, unknown>>()
  const messaggi: Record<string, unknown>[] = []
  const stati: { id: string; stato: string; errore: string | null }[] = []
  const tocca = (wa_id: string, campi: Record<string, unknown> = {}) => {
    const c = contatti.get(wa_id) || { wa_id, utente_id: UTENTE }
    contatti.set(wa_id, { ...c, ...Object.fromEntries(Object.entries(campi).filter(([, v]) => v)) })
  }
  const messaggio = (m: Record<string, any>, wa_id: string, direzione: 'in' | 'out', fonte: string) => {
    if (!m.id || !wa_id || m.type === 'unsupported' && !m.text) return
    tocca(wa_id)
    messaggi.push({ id: m.id, utente_id: UTENTE, wa_id, direzione, fonte, ...contenuto(m), data: quando(m.timestamp), grezzo: m })
  }

  for (const entry of dati.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {}
      const numero = soloCifre(v.metadata?.display_phone_number) || mio
      if (ch.field === 'messages') {
        for (const c of v.contacts || []) tocca(c.wa_id, { nome_profilo: c.profile?.name })
        for (const m of v.messages || []) messaggio(m, m.from, 'in', 'webhook')
        for (const s of v.statuses || []) stati.push({ id: s.id, stato: s.status, errore: s.errors?.[0]?.title || s.errors?.[0]?.message || null })
      } else if (ch.field === 'smb_message_echoes') {
        for (const m of v.message_echoes || []) messaggio(m, m.to, 'out', 'eco')
      } else if (ch.field === 'history') {
        for (const blocco of v.history || []) {
          for (const th of blocco.threads || []) {
            for (const m of th.messages || []) {
              const fuori = soloCifre(m.from) === numero
              messaggio(m, th.id || (fuori ? m.to : m.from), fuori ? 'out' : 'in', 'storico')
            }
          }
        }
      } else if (ch.field === 'smb_app_state_sync') {
        for (const s of v.state_sync || []) {
          if (s.type === 'contact' && s.action !== 'remove' && s.contact?.phone_number) {
            tocca(soloCifre(s.contact.phone_number), { nome_rubrica: s.contact.full_name || s.contact.first_name })
          }
        }
      }
    }
  }

  try {
    // Contatti: i nomi nuovi aggiornano quelli vecchi, il resto (area, scheda…) non si tocca.
    const conNome = [...contatti.values()].filter((c) => c.nome_profilo || c.nome_rubrica)
    const senza = [...contatti.values()].filter((c) => !c.nome_profilo && !c.nome_rubrica)
    for (const gruppo of [conNome.filter((c) => c.nome_rubrica), conNome.filter((c) => !c.nome_rubrica)]) {
      // stesse colonne in ogni riga, sennò PostgREST mette null dove manca
      if (gruppo.length) await inserisci('wa_contatti', gruppo.map((c) => ({ wa_id: c.wa_id, utente_id: UTENTE,
        ...(c.nome_rubrica ? { nome_rubrica: c.nome_rubrica } : { nome_profilo: c.nome_profilo }) })), 'wa_id', true)
    }
    await inserisci('wa_contatti', senza, 'wa_id')
    for (let i = 0; i < messaggi.length; i += 200) await inserisci('wa_messaggi', messaggi.slice(i, i + 200), 'id')
    for (const s of stati) {
      await rest(`wa_messaggi?id=eq.${encodeURIComponent(s.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ stato: s.stato, ...(s.errore ? { errore: s.errore } : {}) }) })
    }
    await rest('wa_collegamento?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ultimo_webhook_il: new Date().toISOString() }) })
  } catch (e) {
    // Meta riprova se non rispondiamo 200: meglio registrare l'errore e rispondere 500 per riavere i dati.
    await rest('lavori_registro', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ lavoro: 'whatsapp', ok: false, errore: String((e as Error)?.message || e).slice(0, 500) }) }).catch(() => {})
    return new Response('errore', { status: 500 })
  }
  return new Response('ok')
})
