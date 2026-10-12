// Copia automatica dal gestionale Ceramex al second brain (fase 2, tappa 2).
// La chiama pg_cron ogni 10 minuti. Legge Ceramex con l'utente di sola lettura "brain_lettore"
// e scrive qui con la chiave di servizio. Gli id restano gli stessi: niente doppioni.
// Le routine "Bozze mail Ceramex" continuano a scrivere le note nel gestionale: questa funzione le porta qui.
import postgres from 'npm:postgres@3.4.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CERAMEX_DB_URL = Deno.env.get('CERAMEX_DB_URL')
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
// La scheda "G&C" del gestionale Ceramex raccoglie vendite G&C: qui quelle note vanno nell'area G&C
// (scheda di parcheggio "G&C" dell'area G), poi l'agente G&C le sposta nella scheda del cliente giusto.
// Le note già spostate in G&C non si toccano più (decisione di Giovanni, 12.10.2026).
const CERAMEX_GC = '2a1997af-facc-4fc2-a611-0f3917256ada'
const PARCHEGGIO_G = '823be55a-9f6b-4a48-b518-5f7d4f4c2081'

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

// Legge tutte le righe di una colonna dal second brain, anche oltre 1000.
async function tutteLeRighe(percorso: string) {
  const righe: Record<string, unknown>[] = []
  for (let da = 0; ; da += 1000) {
    const pezzo = await rest(`${percorso}&offset=${da}&limit=1000`) as Record<string, unknown>[]
    righe.push(...pezzo)
    if (pezzo.length < 1000) return righe
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
      await sql`select * from note_clienti where aggiornato_il > ${da}`,
      await sql`select id from note_clienti`,
      // Dal 12.10.2026 le regole le aggiorna l'agente Ceramex qui: si copiano solo quelle cambiate nel gestionale.
      await sql`select * from note_regole where aggiornato_il > ${da}`,
      await sql`select * from note_mail_viste where visto_il > ${da}`,
      // Bozze mail (ok di Giovanni 12.10.2026): poche righe, cambiano stato senza data → sempre gli ultimi 45 giorni.
      await sql`select * from mail_bozze where creato_il > now() - interval '45 days'`,
      await sql`select email, nome from mail_contatti`,
    ])()])
  } finally {
    sql.end({ timeout: 2 }).catch(() => {})
  }
  const [clienti, note, tutteIds, regole, viste, mailBozze, contatti] = dati

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

  // Note già passate in G&C: restano come le ha sistemate l'agente G&C.
  const inG = new Set<string>()
  for (let i = 0; i < note.length; i += 150) {
    const ids = note.slice(i, i + 150).map((n) => n.id).join(',')
    const t = await rest(`note?select=id&area=eq.G&id=in.(${ids})`) as { id: string }[]
    t.forEach((x) => inG.add(x.id))
  }
  await upsert('note', note.filter((n) => !inG.has(n.id)).map((n) => ({
    id: n.id, utente_id: UTENTE, area: n.cliente_id === CERAMEX_GC ? 'G' : 'C', testo: n.testo, fonte: n.fonte === 'mano' ? 'scritta' : n.fonte,
    azienda_id: n.cliente_id === CERAMEX_GC ? PARCHEGGIO_G : uniteQui.get(n.cliente_id) ?? n.cliente_id, mandante: n.mandante, sezione: n.sezione, data: n.data, contatto: n.persona,
    risolto_il: n.risolto_il, scartata_il: n.scartata_il, thread_id: n.thread_id, message_id: n.message_id,
    testo_agente: n.testo_agente, sezione_agente: n.sezione_agente, imparata: n.imparata,
    creata_il: n.creato_il, modificata_il: n.aggiornato_il, da_ceramex: true,
  })))

  await upsert('regole_agenti', regole.map((g) => ({
    id: g.id, utente_id: UTENTE, area: 'C', agente: 'note', tipo: g.tipo, regola: g.regola, esempi: g.esempi,
    creata_il: g.creato_il, modificata_il: g.aggiornato_il,
  })))

  await upsert('mail_viste', viste.map((v) => ({
    message_id: v.message_id, utente_id: UTENTE, area: 'C', thread_id: v.thread_id,
    esito: v.esito, motivo: v.motivo, vista_il: v.visto_il,
  })), 'message_id')

  // Note cancellate nel gestionale: qui vanno nel cestino. Solo quelle arrivate da Ceramex:
  // le note scritte o dettate nell'app non si toccano.
  const inCeramex = new Set(tutteIds.map((r) => r.id as string))
  const qui = await tutteLeRighe('note?select=id&da_ceramex=is.true&area=eq.C&eliminata_il=is.null&order=id')
  const sparite = qui.map((r) => r.id as string).filter((id) => !inCeramex.has(id))
  for (let i = 0; i < sparite.length; i += 100) {
    await rest(`note?id=in.(${sparite.slice(i, i + 100).join(',')})`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ eliminata_il: new Date().toISOString() }),
    })
  }

  const bozze = await copiaBozze(mailBozze, contatti, clienti)

  return { schede: clienti.length, note: note.length, regole: regole.length, viste: viste.length, cestinate: sparite.length, bozze }
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
