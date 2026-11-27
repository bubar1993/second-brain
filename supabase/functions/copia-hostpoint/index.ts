// Seconda copia del backup G&C su Hostpoint Drive (27.11.2026, ok di Giovanni): porta per il programma del PC
// scripts/copia-hostpoint.ps1, che ogni mattina copia i file nuovi nella cartella di OX Drive.
// Serve solo a scrivere l'esito del giro in lavori_registro (lavoro 'copia-hostpoint'), cosi' il guardiano avvisa
// se la copia non riesce o non parte. Non legge e non scrive nient'altro.
// Si chiama con l'intestazione x-hostpoint-token (segreto HOSTPOINT_TOKEN, sul PC variabile di Windows con lo stesso nome).
// - POST {ok: true, dettagli}  → giro riuscito
// - POST {ok: false, errore}   → giro non riuscito

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const risposta = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

// Confronto a tempo costante (non dice a che punto la chiave e' sbagliata).
function uguali(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

// Solo numeri e testi corti: il registro non deve diventare un deposito.
const CAMPI = ['file_sorgente', 'copiati', 'gia_presenti', 'non_riusciti', 'cambiati_non_copiati', 'tolti_database', 'file_copia', 'codice_robocopy', 'minuti', 'pulizia']
function pulisci(d: unknown) {
  const out: Record<string, unknown> = {}
  if (!d || typeof d !== 'object') return out
  for (const k of CAMPI) {
    const v = (d as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string') out[k] = v.slice(0, 120)
  }
  return out
}

Deno.serve(async (req: Request) => {
  const atteso = Deno.env.get('HOSTPOINT_TOKEN')
  const dato = req.headers.get('x-hostpoint-token') || ''
  if (!atteso || !uguali(dato, atteso)) return risposta({ errore: 'Non autorizzato' }, 401)
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)
  const corpo = await req.json().catch(() => null)
  if (!corpo || typeof corpo !== 'object' || typeof corpo.ok !== 'boolean') return risposta({ errore: 'JSON non valido' }, 400)
  const riga = {
    lavoro: 'copia-hostpoint',
    ok: corpo.ok,
    dettagli: pulisci(corpo.dettagli),
    errore: corpo.ok ? null : String(corpo.errore || 'errore senza testo').slice(0, 300),
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lavori_registro`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(riga),
  })
  if (!r.ok) return risposta({ errore: `registro ${r.status}` }, 500)
  return risposta({ ok: true })
})
