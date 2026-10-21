// Guardiano (21.10.2026, ok di Giovanni). La chiama pg_cron ogni 15 minuti.
// Controlla: le tre app (Brain, Ceramex, G&C), i due gestionali (connessione di sola lettura brain_lettore),
// i giri degli agenti e dei lavori automatici (lavori_registro, copia_registro), il backup, le richieste agli
// agenti rimaste ferme e i lavori di pg_cron falliti. Ogni problema è una riga aperta in "guasti"; quando sparisce
// la riga si chiude. Le notifiche ("Guasto: …" / "Risolto: …") le manda la funzione "notifiche".
// Non ripara niente da solo: segnala e basta.
// Con { "prova": true } dice cosa ha trovato senza scrivere niente.
import postgres from 'npm:postgres@3.4.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')

const APP = [
  ['brain', 'L\'app Brain', 'https://second-brain.aged-king-4bbd.workers.dev/'],
  ['ceramex', 'L\'app Ceramex', 'https://ceramex-app.aged-king-4bbd.workers.dev/'],
  ['gc', 'Il gestionale G&C', 'https://gestionale-gc.aged-king-4bbd.workers.dev/'],
]
const GESTIONALI = [
  ['ceramex', 'Il database del gestionale Ceramex', 'CERAMEX_DB_URL'],
  ['gc', 'Il database del gestionale G&C', 'GC_DB_URL'],
]

// Giri attesi (ora di Zurigo). "max" = minuti senza giri contati solo nelle ore in cui il lavoro gira
// (da/a), così la pausa della notte non conta. Orari in docs/agenti-routine.md.
type Giro = { lavoro: string, nome: string, da: number, a: number, max: number }
const GIRI: Giro[] = [
  { lavoro: 'agente-ceramex', nome: 'L\'agente Ceramex (bozze mail)', da: 6, a: 24, max: 180 },
  { lavoro: 'agente-gc', nome: 'L\'agente G&C', da: 6, a: 24, max: 150 },
  { lavoro: 'agente-calendario', nome: 'L\'agente calendario', da: 6, a: 24, max: 150 },
  { lavoro: 'agente-lavoro', nome: 'L\'agente note lavoro', da: 6, a: 23, max: 150 },
  { lavoro: 'agente-privato', nome: 'L\'agente privato', da: 6, a: 23, max: 150 },
  { lavoro: 'agente-smistatore', nome: 'Lo smistatore', da: 6, a: 23, max: 150 },
  { lavoro: 'agente-gc-archiviazione', nome: 'L\'archiviazione email G&C', da: 6, a: 23, max: 210 },
  { lavoro: 'agente-seguire', nome: 'L\'agente "Da seguire"', da: 7, a: 22, max: 210 },
  { lavoro: 'copia-gc', nome: 'La copia dal gestionale G&C', da: 0, a: 24, max: 150 },
  { lavoro: 'posta-gc', nome: 'La lettura della posta info@', da: 0, a: 24, max: 30 },
]
// Giri una volta al giorno o alla settimana: guasto se dopo l'ora "entro" di oggi non c'è ancora il giro.
const GIORNALIERI = [
  { lavoro: 'agente-ceramex-liste', nome: 'L\'archiviazione delle liste di carico Ceramex (6:52)', entro: 9 },
]
const SETTIMANALI = [
  { lavoro: 'agente-gc-fornitori', nome: 'Il completamento fornitori G&C (venerdì)', giorni: 8 },
]
const NOMI_AGENTI: Record<string, string> = {
  capo: 'il Capo', lavoro: 'l\'agente note lavoro', privato: 'l\'agente privato', ceramex: 'l\'agente Ceramex',
  gc: 'l\'agente G&C', calendario: 'l\'agente calendario', archiviazione: 'l\'archiviazione email G&C', smistatore: 'lo smistatore',
}

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

// ---------- tempo (ora di Zurigo) ----------
const formato = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hourCycle: 'h23',
})
const oraZurigo = (ms: number) => {
  const p = Object.fromEntries(formato.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { ora: Number(p.hour), minuti: Number(p.minute), giorno: `${p.day}.${p.month}` }
}
const quando = (iso?: string) => {
  if (!iso) return 'mai'
  const z = oraZurigo(Date.parse(iso))
  return `${z.giorno} alle ${String(z.ora).padStart(2, '0')}:${String(z.minuti).padStart(2, '0')}`
}
// Minuti tra "da" e "a" che cadono nelle ore [oraDa, oraA) di Zurigo (passi di 5 minuti).
function minutiAttivi(daMs: number, aMs: number, oraDa: number, oraA: number) {
  let n = 0
  for (let t = daMs; t < aMs; t += 5 * 60000) {
    const { ora } = oraZurigo(t)
    if (ora >= oraDa && ora < oraA) n += 5
  }
  return n
}

// ---------- controlli ----------
type Problema = { chiave: string, titolo: string, dettaglio: string }

async function conRiprova<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch {
    await new Promise((r) => setTimeout(r, 4000))
    return await fn()
  }
}

async function controllaApp(): Promise<Problema[]> {
  const out: Problema[] = []
  await Promise.all(APP.map(async ([codice, nome, url]) => {
    try {
      await conRiprova(async () => {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'second-brain-guardiano' } })
        await r.body?.cancel()
        if (r.status >= 400) throw new Error(`risponde ${r.status}`)
      })
    } catch (e) {
      out.push({ chiave: `app:${codice}`, titolo: `${nome} non si apre`, dettaglio: `${url} → ${(e as Error).message}` })
    }
  }))
  return out
}

async function controllaGestionali(): Promise<Problema[]> {
  const out: Problema[] = []
  await Promise.all(GESTIONALI.map(async ([codice, nome, segreto]) => {
    const dburl = Deno.env.get(segreto)
    if (!dburl) return
    try {
      await conRiprova(async () => {
        const sql = postgres(dburl, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 2 })
        try {
          await Promise.race([sql`select 1`, new Promise((_, no) => setTimeout(() => no(new Error('non risponde (20 s)')), 20000))])
        } finally {
          sql.end({ timeout: 2 }).catch(() => {})
        }
      })
    } catch (e) {
      out.push({ chiave: `db:${codice}`, titolo: `${nome} non risponde`, dettaglio: (e as Error).message.slice(0, 300) })
    }
  }))
  return out
}

type UltimoGiro = { il: string, ok: boolean, errore: string | null }

function controllaGiri(d: any, adesso: number): Problema[] {
  const out: Problema[] = []
  const giri: Record<string, UltimoGiro> = d.giri || {}
  const giroErrato = (lavoro: string, nome: string, g?: UltimoGiro) => {
    if (g && !g.ok) out.push({ chiave: `giro:${lavoro}`, titolo: `${nome}: l'ultimo giro non è riuscito`, dettaglio: `${quando(g.il)}: ${g.errore || 'errore'}` })
    return !!(g && !g.ok)
  }

  for (const r of GIRI) {
    const g = giri[r.lavoro]
    if (giroErrato(r.lavoro, r.nome, g)) continue
    const ultimo = g ? Date.parse(g.il) : adesso - 10 * 864e5
    if (minutiAttivi(ultimo, adesso, r.da, r.a) > r.max) {
      out.push({ chiave: `giro:${r.lavoro}`, titolo: `${r.nome} è fermo`, dettaglio: `Ultimo giro: ${quando(g?.il)}` })
    }
  }

  const z = oraZurigo(adesso)
  for (const r of GIORNALIERI) {
    const g = giri[r.lavoro]
    if (giroErrato(r.lavoro, r.nome, g)) continue
    const oggi = g && oraZurigo(Date.parse(g.il)).giorno === z.giorno
    if (z.ora >= r.entro && !oggi) {
      out.push({ chiave: `giro:${r.lavoro}`, titolo: `${r.nome} oggi non è partita`, dettaglio: `Ultimo giro: ${quando(g?.il)}` })
    }
  }
  for (const r of SETTIMANALI) {
    const g = giri[r.lavoro]
    if (giroErrato(r.lavoro, r.nome, g)) continue
    if (!g || adesso - Date.parse(g.il) > r.giorni * 864e5) {
      out.push({ chiave: `giro:${r.lavoro}`, titolo: `${r.nome} non gira da più di una settimana`, dettaglio: `Ultimo giro: ${quando(g?.il)}` })
    }
  }

  // Copia delle note da Ceramex (ogni 10 minuti, registro a parte).
  const c: UltimoGiro | null = d.copia_ceramex
  if (c && !c.ok) out.push({ chiave: 'giro:copia-ceramex', titolo: 'La copia delle note da Ceramex non è riuscita', dettaglio: `${quando(c.il)}: ${c.errore || 'errore'}` })
  else if (!c || adesso - Date.parse(c.il) > 40 * 60000) out.push({ chiave: 'giro:copia-ceramex', titolo: 'La copia delle note da Ceramex è ferma', dettaglio: `Ultima copia: ${quando(c?.il)}` })

  // Backup su Drive (domenica notte).
  const b: UltimoGiro | null = d.backup
  if (b && !b.ok) out.push({ chiave: 'backup', titolo: 'Il backup su Drive non è riuscito', dettaglio: `${quando(b.il)}: ${b.errore || 'errore'}` })
  else if (!b || adesso - Date.parse(b.il) > 8 * 864e5) out.push({ chiave: 'backup', titolo: 'Il backup su Drive non parte da più di una settimana', dettaglio: `Ultimo: ${quando(b?.il)}` })
  return out
}

// Richieste agli agenti ferme da più di 3 ore (contate dalle 6 alle 23).
function controllaRichieste(d: any, adesso: number): Problema[] {
  const ferme = new Map<string, { n: number, il: string }>()
  for (const r of d.richieste || []) {
    if (minutiAttivi(Date.parse(r.il), adesso, 6, 23) <= 180) continue
    const x = ferme.get(r.agente) || { n: 0, il: r.il }
    x.n++
    if (r.il < x.il) x.il = r.il
    ferme.set(r.agente, x)
  }
  return [...ferme].map(([agente, x]) => ({
    chiave: `richieste:${agente}`,
    titolo: `${x.n === 1 ? 'Una richiesta' : `${x.n} richieste`} per ${NOMI_AGENTI[agente] || agente} ${x.n === 1 ? 'è ferma' : 'sono ferme'}`,
    dettaglio: `La più vecchia è del ${quando(x.il)}`,
  }))
}

function controllaCron(d: any): Problema[] {
  const ko: { nome: string, il: string, errore: string }[] = d.cron_ko || []
  const nomi = [...new Set(ko.map((k) => k.nome))]
  return nomi.map((nome) => {
    const k = ko.find((x) => x.nome === nome)!
    return { chiave: `cron:${nome}`, titolo: `Il lavoro automatico "${nome}" non parte`, dettaglio: `${quando(k.il)}: ${k.errore || 'errore'}` }
  })
}

Deno.serve(async (req) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) return new Response('Non autorizzato', { status: 401 })
  const { prova } = await req.json().catch(() => ({}))

  let problemi: Problema[]
  try {
    const dati = await rest('rpc/guardiano_dati', { method: 'POST', body: '{}' })
    const adesso = Date.parse(dati.adesso)
    const [app, db] = await Promise.all([controllaApp(), controllaGestionali()])
    problemi = [...app, ...db, ...controllaGiri(dati, adesso), ...controllaRichieste(dati, adesso), ...controllaCron(dati)]
  } catch (e) {
    // Il guardiano stesso non riesce a leggere: lo segno come guasto (se almeno scrivere funziona).
    problemi = [{ chiave: 'guardiano', titolo: 'Il guardiano non riesce a fare i controlli', dettaglio: (e as Error).message.slice(0, 300) }]
  }
  if (prova) return Response.json({ prova: true, problemi })

  const aperti: { id: string, chiave: string }[] = await rest('guasti?select=id,chiave&chiuso_il=is.null')
  const adessoIso = new Date().toISOString()
  const nuovi: string[] = []
  const risolti: string[] = []
  for (const p of problemi) {
    const gia = aperti.find((a) => a.chiave === p.chiave)
    if (gia) {
      await rest(`guasti?id=eq.${gia.id}`, { method: 'PATCH', body: JSON.stringify({ titolo: p.titolo, dettaglio: p.dettaglio, visto_il: adessoIso }) })
    } else {
      await rest('guasti', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(p) })
        .then(() => nuovi.push(p.titolo)).catch(() => {}) // già aperto da un giro parallelo
    }
  }
  for (const a of aperti) {
    if (problemi.some((p) => p.chiave === a.chiave)) continue
    await rest(`guasti?id=eq.${a.id}`, { method: 'PATCH', body: JSON.stringify({ chiuso_il: adessoIso }) })
    risolti.push(a.chiave)
  }
  if (nuovi.length || risolti.length) {
    await rest('lavori_registro', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ lavoro: 'guardiano', ok: true, dettagli: { nuovi, risolti, aperti: problemi.length,
        riepilogo: [nuovi.length && `Guasti nuovi: ${nuovi.join('; ')}`, risolti.length && `Risolti: ${risolti.length}`].filter(Boolean).join(' · ') } }),
    }).catch(() => {})
  }
  return Response.json({ ok: true, aperti: problemi.length, nuovi, risolti })
})
