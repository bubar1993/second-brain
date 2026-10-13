// Copia automatica dal gestionale Ceramex al second brain (fase 2, tappa 2).
// La chiama pg_cron ogni 10 minuti. Legge Ceramex con l'utente di sola lettura "brain_lettore"
// e scrive qui con la chiave di servizio. Gli id restano gli stessi: niente doppioni.
// Dal 13.10.2026 (passo 2 del trasloco, ok di Giovanni) copia SOLO schede clienti e bozze: note, regole e mail viste
// stanno ormai solo qui (l'agente Ceramex le scrive qui dal 12.10) e si correggono nell'app. Le note vecchie restano
// nel gestionale finché Giovanni non decide di cancellarle: qui non vanno più nel cestino se spariscono là.
import postgres from 'npm:postgres@3.4.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CERAMEX_DB_URL = Deno.env.get('CERAMEX_DB_URL')
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
// La scheda "G&C" del gestionale Ceramex (vendite G&C) non si copia: le sue note sono già nell'area G.
const CERAMEX_GC = '2a1997af-facc-4fc2-a611-0f3917256ada'

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }

async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}

async function upsert(tabella: string, righe: unknown[], conflitto = 'id') {
  for (let i = 0; i < righe.length; i += 300) {
    await rest(`${tabella}?on_conflict=${conflitto}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(righe.slice(i, i + 300)),
    })
  }
}

async function copia() {
  // Dall'ultima copia riuscita (con 10 minuti di margine); la prima volta, tutto.
  const [ultima] = await rest('copia_registro?select=iniziata_il&ok=eq.true&order=id.desc&limit=1') as { iniziata_il: string }[]
  const da = ultima ? new Date(new Date(ultima.iniziata_il).getTime() - 10 * 60000).toISOString() : '1970-01-01T00:00:00Z'

  const sql = postgres(CERAMEX_DB_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5 })
  let dati
  try {
    // Se Ceramex non risponde, meglio un errore chiaro nel registro che restare appesi.
    const scaduto = new Promise<never>((_, no) => setTimeout(() => no(new Error('Ceramex non risponde (40 s)')), 40000))
    dati = await Promise.race([scaduto, (async () => [
      await sql`select * from clienti`,
      // Bozze mail (ok di Giovanni 12.10.2026): poche righe, cambiano stato senza data → sempre gli ultimi 45 giorni.
      await sql`select * from mail_bozze where creato_il > now() - interval '45 days'`,
      await sql`select email, nome from mail_contatti`,
    ])()])
  } finally {
    sql.end({ timeout: 2 }).catch(() => {})
  }
  const [clienti, mailBozze, contatti] = dati

  // Schede unite qui dall'agente "da seguire" (schede doppie, ok di Giovanni): restano unite e le loro note
  // vanno nella scheda tenuta, anche se nel gestionale sono ancora due.
  const uniteQui = new Map(((await rest('aziende?select=id,unito_in&area=eq.C&unito_in=not.is.null')) as { id: string, unito_in: string }[])
    .map((a) => [a.id, a.unito_in]))

  // Schede: solo quelle cambiate nel gestionale (dal 12.10.2026 l'agente Ceramex aggiunge persone e indirizzi qui,
  // e una copia completa ogni 10 minuti le cancellerebbe). Tutte le schede servono comunque a copiaBozze.
  await upsert('aziende', clienti.filter((c) => c.id !== CERAMEX_GC && new Date(c.aggiornato_il) > new Date(da)).map((c) => ({
    id: c.id, utente_id: UTENTE, area: 'C', nome: c.nome, ragione_sociale: c.azienda,
    email: c.email, domini: c.domini, contatti: c.persone, gruppo_id: c.gruppo_id, unito_in: uniteQui.get(c.id) ?? c.unito_in,
    creata_il: c.creato_il, modificata_il: c.aggiornato_il,
  })))

  const bozze = await copiaBozze(mailBozze, contatti, clienti)

  return { schede: clienti.length, bozze }
}

// Bozze Ceramex → tabella bozze (area C, canale gmail, stesso id). Quello che Giovanni ha già fatto
// nell'app (inviata, scartata) vale più dello stato "proposta" del gestionale, che si aggiorna solo al giro dopo.
async function copiaBozze(righe: Record<string, any>[], contatti: Record<string, any>[], clienti: Record<string, any>[]) {
  if (!righe.length) return 0
  const nomi = new Map(contatti.map((c) => [String(c.email).toLowerCase(), c.nome]))
  const perDominio = new Map<string, string>()
  const perEmail = new Map<string, string>()
  for (const c of clienti) {
    if (c.unito_in || c.id === CERAMEX_GC) continue
    for (const d of c.domini || []) perDominio.set(String(d).toLowerCase(), c.id)
    for (const e of c.email || []) perEmail.set(String(e).toLowerCase(), c.id)
  }
  const indirizzo = (b: Record<string, any>) => {
    const m = String(b.contatto || b.perche?.mittente || '').match(/[^\s<>"]+@[^\s<>"]+/)
    return m ? m[0].toLowerCase() : null
  }
  const locali = new Map<string, string>()
  const ids = righe.map((b) => b.id)
  for (let i = 0; i < ids.length; i += 150) {
    const t = await rest(`bozze?select=id,stato&id=in.(${ids.slice(i, i + 150).join(',')})`) as { id: string; stato: string }[]
    t.forEach((x) => locali.set(x.id, x.stato))
  }
  const fatteQui = ['inviata', 'scartata', 'in_invio', 'annullata']

  // Si scrivono solo le bozze nuove e quelle che hanno cambiato stato: così una correzione fatta
  // nell'app (testo) non viene ricoperta ogni 10 minuti.
  const nuove = righe.map((b) => {
    const email = indirizzo(b)
    const azienda = email ? perEmail.get(email) || perDominio.get(email.split('@')[1]) || null : null
    const stato = b.stato === 'imparata' ? 'annullata' : b.stato
    return {
      id: b.id, utente_id: UTENTE, area: 'C', canale: 'gmail', stato,
      oggetto: b.oggetto, testo: b.testo_bozza, testo_agente: b.testo_bozza, perche: b.perche || {},
      a: email ? [email] : [], azienda_id: azienda,
      da_nome: (email && nomi.get(email)) || b.perche?.mittente || email,
      gmail_draft_id: b.gmail_draft_id, gmail_thread_id: b.thread_id, gmail_message_id: b.message_id,
      testo_inviato: b.testo_inviato, differenze: b.differenze,
      creata_il: b.creato_il, modificata_il: b.inviato_il || b.creato_il,
      inviata_il: b.stato === 'inviata' ? b.inviato_il : null,
      annullata_il: b.stato === 'imparata' ? b.inviato_il : null,
      motivo_annullata: b.stato === 'imparata' ? 'Hai risposto tu da Gmail' : null,
    }
  }).filter((r) => {
    const qui = locali.get(r.id)
    if (!qui) return true
    if (qui === r.stato) return false
    return !(fatteQui.includes(qui) && (r.stato === 'proposta' || r.stato === 'da_imparare'))
  })
  await upsert('bozze', nuove)
  return nuove.length
}

Deno.serve(async (req: Request) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) {
    return new Response('Non autorizzato', { status: 401 })
  }
  const iniziata_il = new Date().toISOString()
  let esito
  try {
    if (!CERAMEX_DB_URL) throw new Error('Manca il segreto CERAMEX_DB_URL')
    esito = { ok: true, dettagli: await copia(), errore: null }
  } catch (e) {
    esito = { ok: false, dettagli: null, errore: String((e as Error)?.message || e).slice(0, 500) }
  }
  await rest('copia_registro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ iniziata_il, ...esito }) })
    .catch(() => {})
  return new Response(JSON.stringify(esito), { status: esito.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
})
