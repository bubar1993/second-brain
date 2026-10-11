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
      await sql`select * from note_regole`,
      await sql`select * from note_mail_viste where visto_il > ${da}`,
    ])()])
  } finally {
    sql.end({ timeout: 2 }).catch(() => {})
  }
  const [clienti, note, tutteIds, regole, viste] = dati

  await upsert('aziende', clienti.filter((c) => c.id !== CERAMEX_GC).map((c) => ({
    id: c.id, utente_id: UTENTE, area: 'C', nome: c.nome, ragione_sociale: c.azienda,
    email: c.email, domini: c.domini, contatti: c.persone, gruppo_id: c.gruppo_id, unito_in: c.unito_in,
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
    azienda_id: n.cliente_id === CERAMEX_GC ? PARCHEGGIO_G : n.cliente_id, mandante: n.mandante, sezione: n.sezione, data: n.data, contatto: n.persona,
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

  return { schede: clienti.length, note: note.length, regole: regole.length, viste: viste.length, cestinate: sparite.length }
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
