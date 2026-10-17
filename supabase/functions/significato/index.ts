// Ricerca per significato (13.10.2026, ok di Giovanni: gratis). Il modello multilingue bge-m3 di Cloudflare
// (Worker dell'app, /api/vettori) trasforma ogni testo in un vettore; cose con significato vicino hanno vettori vicini.
// Azioni:
//   { azione: 'indicizza' }                → vettori delle note, mail, schede persona e WhatsApp nuovi o cambiati
//                                             (pg_cron ogni 10 min, x-copia-token);
//   { azione: 'cerca', q, area?, quanti? } → le cose più vicine alla domanda (Giovanni da Chiedi; anche col token per le prove).
// Tetto giornaliero di testo mandato (vettori_uso): così si resta sempre nella parte gratuita di Workers AI.
import { daConnettore } from '../_shared/accesso.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const VETTORI_TOKEN = Deno.env.get('VETTORI_TOKEN')!
const WORKER = 'https://second-brain.aged-king-4bbd.workers.dev/api/vettori'
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const TETTO_GIORNO = 12_000_000 // caratteri al giorno (~3,5 milioni di token, circa un terzo della quota gratuita)
const PER_VOLTA = 25

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const risposta = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Riga = Record<string, any>
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, {
    ...init,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]}: ${r.status} ${await r.text()}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}
const rpc = (nome: string, args: Riga) => rest(`rpc/${nome}`, { method: 'POST', body: JSON.stringify(args) })

const oggi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
async function usati() {
  const [r] = await rest(`vettori_uso?giorno=eq.${oggi()}&select=caratteri`) as Riga[]
  return Number(r?.caratteri || 0)
}
async function conta(caratteri: number, gia: number) {
  await rest('vettori_uso?on_conflict=giorno', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ giorno: oggi(), caratteri: gia + caratteri }) })
}

async function vettori(testi: string[]): Promise<number[][]> {
  const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vettori-token': VETTORI_TOKEN },
    body: JSON.stringify({ testi }) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !Array.isArray(d.vettori)) throw new Error(`Modello: ${r.status} ${d.errore || ''}`)
  return d.vettori
}

async function indicizza() {
  const fine = Date.now() + 45_000
  let fatti = 0
  let gia = await usati()
  while (Date.now() < fine) {
    if (gia >= TETTO_GIORNO) return { fatti, fermo: 'tetto del giorno raggiunto' }
    const righe = await rpc('vettori_da_fare', { quanti: PER_VOLTA }) as Riga[]
    if (!righe.length) return { fatti, resto: 0 }
    const v = await vettori(righe.map((r) => r.testo))
    await rest('vettori?on_conflict=tipo,rif', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(righe.map((r, i) => ({ tipo: r.tipo, rif: r.rif, impronta: r.impronta,
        vettore: JSON.stringify(v[i]), aggiornato_il: new Date().toISOString() }))) })
    const caratteri = righe.reduce((s, r) => s + r.testo.length, 0)
    await conta(caratteri, gia)
    gia += caratteri
    fatti += righe.length
  }
  return { fatti, resto: 'continua al prossimo giro' }
}

async function cerca(q: string, area: string | null, quanti: number) {
  const gia = await usati()
  if (gia >= TETTO_GIORNO) return { risultati: [], fermo: 'tetto del giorno raggiunto' }
  const [v] = await vettori([q])
  await conta(q.length, gia)
  // Sotto 0.5 di somiglianza (bge-m3) di solito non c'entra niente.
  const risultati = await rpc('cerca_significato', { q: JSON.stringify(v), area_scelta: area, quanti, minimo: 0.5 })
  return { risultati }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)
  const corpo = await req.json().catch(() => ({}))
  const { azione, q, area, quanti } = corpo

  const programmato = !!COPIA_TOKEN && req.headers.get('x-copia-token') === COPIA_TOKEN
  if (!programmato) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
    const utente = u.ok ? await u.json() : null
    if (utente?.id !== UTENTE || daConnettore(jwt)) return risposta({ errore: 'Non autorizzato' }, 401)
    if (azione !== 'cerca') return risposta({ errore: 'Non autorizzato' }, 401)
  }

  try {
    if (azione === 'indicizza') return risposta({ ok: true, ...(await indicizza()) })
    if (azione === 'cerca') {
      const domanda = String(q || '').trim().slice(0, 500)
      if (domanda.length < 3) return risposta({ risultati: [] })
      const a = ['C', 'G', 'P'].includes(area) ? area : null
      return risposta(await cerca(domanda, a, Math.min(Math.max(Number(quanti) || 15, 1), 40)))
    }
    return risposta({ errore: 'Azione sconosciuta' }, 400)
  } catch (e) {
    return risposta({ errore: String((e as Error)?.message || e) }, 500)
  }
})
