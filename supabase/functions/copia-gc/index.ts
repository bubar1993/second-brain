// Copia dal gestionale G&C al second brain (fase 5). La chiama pg_cron ogni ora.
// Legge G&C con l'utente di sola lettura "brain_lettore": clienti, cantieri, fornitori principali
// e le mail salvate nel gestionale (con cliente, cantiere e fornitore già assegnati); dal 19.10.2026 anche i
// riassunti della "Copia AbaNinja serale" (solo quelle righe di modifiche_da_controllare), che vanno in Agenti.
// Gli id restano gli stessi del gestionale: niente doppioni. Non scrive mai nel gestionale.
import postgres from 'npm:postgres@3.4.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GC_DB_URL = Deno.env.get('GC_DB_URL')
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'

const PUBBLICI = ['gmail.com', 'googlemail.com', 'bluewin.ch', 'hotmail.com', 'hotmail.it', 'outlook.com', 'live.com',
  'yahoo.com', 'yahoo.it', 'gmx.ch', 'gmx.net', 'gmx.de', 'icloud.com', 'me.com', 'sunrise.ch', 'swissonline.ch',
  'hispeed.ch', 'ticino.com', 'libero.it', 'tiscali.it', 'web.de', 'proton.me', 'protonmail.com']

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }

async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}

async function upsert(tabella: string, righe: unknown[], conflitto = 'id', ignora = false) {
  for (let i = 0; i < righe.length; i += 200) {
    await rest(`${tabella}?on_conflict=${conflitto}`, {
      method: 'POST',
      headers: { Prefer: `resolution=${ignora ? 'ignore' : 'merge'}-duplicates,return=minimal` },
      body: JSON.stringify(righe.slice(i, i + 200)),
    })
  }
}

const indirizzi = (s?: string | null) =>
  [...new Set(((s || '').match(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/g) || []).map((x) => x.toLowerCase()))]
// Domini aziendali di tutti gli indirizzi (i domini pubblici non identificano un'azienda).
const domini = (s?: string | null) =>
  [...new Set(indirizzi(s).map((e) => e.split('@')[1]).filter((d) => d && !PUBBLICI.includes(d)))]
const pulisciId = (s?: string | null) => (s || '').trim().replace(/^<|>$/g, '')

async function copia() {
  const [ultima] = await rest(`lavori_registro?select=iniziata_il&lavoro=eq.copia-gc&ok=eq.true&order=id.desc&limit=1`) as { iniziata_il: string }[]
  const da = ultima ? new Date(new Date(ultima.iniziata_il).getTime() - 15 * 60000).toISOString() : '1970-01-01T00:00:00Z'

  const sql = postgres(GC_DB_URL!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5 })
  let dati
  try {
    const scaduto = new Promise<never>((_, no) => setTimeout(() => no(new Error('G&C non risponde (60 s)')), 60000))
    dati = await Promise.race([scaduto, (async () => [
      await sql`select id, name, company_name, email, city, created_at from clients`,
      await sql`select id, client_id, name, status, notes, created_at from sites`,
      await sql`select id, name, company_name, email, section, created_at from price_list_suppliers where kind = 'principale'`,
      await sql`select id, message_id, direction, from_addr, from_name, to_addrs, cc_addrs, subject, sent_at, body_text,
                       attachments, client_id, site_id, supplier_id, note
                  from email_messages where removed_at is null and coalesce(saved_at, sent_at) > ${da}
                 order by sent_at`,
      // Riassunti della "Copia AbaNinja serale" (19.10.2026, ok di Giovanni): brain_lettore vede solo queste righe.
      await sql`select id, titolo, dettaglio, creato_il from modifiche_da_controllare
                 where fonte = 'abaninja' and tipo = 'completato' and creato_il > now() - interval '7 days'`,
    ])()])
  } finally {
    sql.end({ timeout: 2 }).catch(() => {})
  }
  const [clienti, cantieri, fornitori, mail, abaninja] = dati

  // Schede: nome e ragione sociale dal gestionale; email e domini si sommano a quelli imparati dall'agente.
  const esistenti = new Map(((await rest(`aziende?select=id,email,domini&area=eq.G&limit=5000`)) as { id: string, email: string[], domini: string[] }[])
    .map((a) => [a.id, a]))
  await upsert('aziende', clienti.map((c) => {
    const e = esistenti.get(c.id)
    const email = [...new Set([...(e?.email || []), ...indirizzi(c.email)])]
    return { id: c.id, utente_id: UTENTE, area: 'G', nome: c.name || c.company_name, ragione_sociale: c.company_name,
      email, domini: [...new Set([...(e?.domini || []), ...domini(c.email)])], creata_il: c.created_at }
  }))

  // Schede doppie unite qui dall'agente "da seguire" (ok di Giovanni): cantieri e mail vanno sulla scheda tenuta.
  const uniteQui = new Map(((await rest('aziende?select=id,unito_in&area=eq.G&unito_in=not.is.null')) as { id: string, unito_in: string }[])
    .map((a) => [a.id, a.unito_in]))
  const scheda = (id: string | null) => (id && uniteQui.get(id)) || id

  await upsert('cantieri', cantieri.map((s) => ({
    id: s.id, utente_id: UTENTE, area: 'G', azienda_id: scheda(s.client_id), nome: s.name, stato: s.status,
    descrizione: s.notes || null, creata_il: s.created_at,
  })))

  // Fornitori: nome_breve e domini in più (es. marazzigroup.com) si decidono qui e non si perdono.
  const fornEsistenti = new Map(((await rest(`fornitori?select=id,domini&limit=1000`)) as { id: string, domini: string[] }[])
    .map((f) => [f.id, f.domini]))
  await upsert('fornitori', fornitori.map((f) => ({
    id: f.id, utente_id: UTENTE, area: 'G', nome: f.name, ragione_sociale: f.company_name, email: f.email,
    domini: [...new Set([...(fornEsistenti.get(f.id) || []), ...domini(f.email)])], settore: f.section, creata_il: f.created_at,
  })))

  // Mail salvate nel gestionale: cliente/cantiere/fornitore e la nota d'archivio. Il resto lo completa posta-gc.
  const idForn = new Set(fornitori.map((f) => f.id as string))
  const righe = mail.map((m) => {
    const id = pulisciId(m.message_id)
    return {
      message_id: id, utente_id: UTENTE, area: 'G', cartella: m.direction === 'inviata' ? 'inviata' : 'arrivata',
      da: (indirizzi(m.from_addr)[0] || m.from_addr || '').toLowerCase(), da_nome: m.from_name,
      a: indirizzi(m.to_addrs), cc: indirizzi(m.cc_addrs), oggetto: m.subject, data: m.sent_at,
      testo: (m.body_text || '').slice(0, 60000), allegati: m.attachments || [],
      azienda_id: scheda(m.client_id), cantiere_id: m.site_id, fornitore_id: idForn.has(m.supplier_id) ? m.supplier_id : null,
      nota_gestionale: m.note, fonte: 'gestionale',
    }
  }).filter((r) => r.message_id)
  // Le mail già lette dalla casella hanno thread e testo completi: qui si aggiornano solo le assegnazioni.
  const gia = new Set<string>()
  for (let i = 0; i < righe.length; i += 150) {
    const ids = righe.slice(i, i + 150).map((r) => `"${r.message_id.replace(/"/g, '\\"')}"`).join(',')
    const t = await rest(`posta?select=message_id&message_id=in.(${encodeURIComponent(ids)})`) as { message_id: string }[]
    t.forEach((x) => gia.add(x.message_id))
  }
  const nuove = righe.filter((r) => !gia.has(r.message_id)).map((r) => ({ ...r, thread_key: r.message_id }))
  await upsert('posta', nuove, 'message_id', true)
  for (const r of righe.filter((r) => gia.has(r.message_id))) {
    await rest(`posta?message_id=eq.${encodeURIComponent(r.message_id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ azienda_id: r.azienda_id, cantiere_id: r.cantiere_id, fornitore_id: r.fornitore_id, nota_gestionale: r.nota_gestionale }),
    })
  }

  // Ogni riassunto della Copia AbaNinja diventa un giro in Agenti ('agente-gc-abaninja'), una volta sola.
  const giaRiassunti = new Set(((await rest(`lavori_registro?select=dettagli->>id&lavoro=eq.agente-gc-abaninja&iniziata_il=gte.${new Date(Date.now() - 8 * 864e5).toISOString()}`)) as { id: string }[])
    .map((g) => g.id))
  const riassunti = abaninja.filter((r) => !giaRiassunti.has(r.id)).map((r) => ({
    lavoro: 'agente-gc-abaninja', iniziata_il: r.creato_il, ok: true,
    dettagli: { id: r.id, riepilogo: `${r.titolo}. ${(r.dettaglio || '').replace(/\s*\n+\s*/g, ' · ')}`.slice(0, 2000) },
  }))
  if (riassunti.length) await rest('lavori_registro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(riassunti) })

  return { schede: clienti.length, cantieri: cantieri.length, fornitori: fornitori.length, mail: righe.length, mail_nuove: nuove.length, riassunti_abaninja: riassunti.length }
}

Deno.serve(async (req: Request) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) {
    return new Response('Non autorizzato', { status: 401 })
  }
  const iniziata_il = new Date().toISOString()
  let esito
  try {
    if (!GC_DB_URL) throw new Error('Manca il segreto GC_DB_URL')
    esito = { ok: true, dettagli: await copia(), errore: null }
  } catch (e) {
    esito = { ok: false, dettagli: null, errore: String((e as Error)?.message || e).slice(0, 500) }
  }
  await rest('lavori_registro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lavoro: 'copia-gc', iniziata_il, ...esito }) })
    .catch(() => {})
  return new Response(JSON.stringify(esito), { status: esito.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
})
