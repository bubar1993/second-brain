// Gruppi WhatsApp di lavoro (13.11.2026, ok di Giovanni): porta per il programma del PC scripts/wa-gruppi.ps1,
// che di notte legge i gruppi da WhatsApp Desktop (i gruppi non passano dal collegamento ufficiale di Meta).
// Si chiama con l'intestazione x-gruppi-token (segreto GRUPPI_TOKEN, sul PC variabile di Windows con lo stesso nome).
// - GET                         → gruppi attivi da leggere, ognuno con la data dell'ultimo messaggio gia' salvato
// - POST {letto_il, gruppi, esito} → salva i messaggi nuovi (i doppioni si scartano da soli) e scrive il registro
// - POST {letto_il, errore}     → il giro non e' riuscito (WhatsApp chiuso, non collegato…): riga di errore nel registro
// La porta decide tutto lei: gruppo e area vengono da wa_gruppi (nome identico, attivo), mai dalla richiesta.
// I testi sono messaggi di altre persone: qui si salvano e basta, nessuno li esegue.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_GRUPPI = 30
const MAX_MESSAGGI = 1500 // per gruppo, per richiesta
const TIPI = ['testo', 'documento', 'foto', 'vocale']

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}
const risposta = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

// Confronto a tempo costante (non dice a che punto la chiave e' sbagliata).
function uguali(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}
const registro = (ok: boolean, dettagli: unknown, errore: string | null = null) =>
  rest('lavori_registro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lavoro: 'wa-gruppi', ok, dettagli, errore }) })

type Gruppo = { id: string; nome: string; area: string }

Deno.serve(async (req: Request) => {
  const atteso = Deno.env.get('GRUPPI_TOKEN')
  const dato = req.headers.get('x-gruppi-token') || ''
  if (!atteso || !uguali(dato, atteso)) return risposta({ errore: 'Non autorizzato' }, 401)
  try {
    const gruppi = await rest('wa_gruppi?attivo=is.true&select=id,nome,area&order=nome') as Gruppo[]

    if (req.method === 'GET') {
      const out = []
      for (const g of gruppi) {
        const [u] = await rest(`wa_gruppi_messaggi?gruppo_id=eq.${g.id}&select=data&order=data.desc&limit=1`) as { data: string }[]
        out.push({ nome: g.nome, ultimo: u?.data || null })
      }
      return risposta({ gruppi: out })
    }
    if (req.method !== 'POST') return risposta({ errore: 'Usa GET o POST' }, 405)

    const corpo = await req.json().catch(() => null)
    if (!corpo || typeof corpo !== 'object') return risposta({ errore: 'JSON non valido' }, 400)
    if (typeof corpo.errore === 'string' && corpo.errore) {
      await registro(false, { letto_il: String(corpo.letto_il || '').slice(0, 40) }, corpo.errore.slice(0, 300))
      return risposta({ ok: true, registrato: 'errore' })
    }
    if (!Array.isArray(corpo.gruppi) || corpo.gruppi.length > MAX_GRUPPI) return risposta({ errore: 'gruppi mancanti o troppi' }, 400)

    const adesso = Date.now()
    const esitoPc: Record<string, any> = {}
    for (const e of Array.isArray(corpo.esito) ? corpo.esito.slice(0, MAX_GRUPPI) : []) {
      if (e && typeof e.gruppo === 'string') {
        esitoPc[e.gruppo] = { ok: e.ok === true, errore: typeof e.errore === 'string' ? e.errore.slice(0, 200) : undefined,
          messaggi: Number(e.messaggi) || 0, passi: Number(e.passi) || 0, non_letti_prima: Number(e.non_letti_prima) || 0, non_letti_dopo: Number(e.non_letti_dopo) || 0 }
      }
    }
    const riepilogo: Record<string, unknown>[] = []
    let nuovi = 0
    for (const g of gruppi) {
      const p = corpo.gruppi.find((x: any) => x && x.nome === g.nome)
      const e = esitoPc[g.nome]
      const riga: Record<string, unknown> = { gruppo: g.nome, letto: !!p, ...(e || {}) }
      if (p && Array.isArray(p.messaggi)) {
        const righe = []
        const viste = new Set<string>()
        for (const m of p.messaggi.slice(0, MAX_MESSAGGI)) {
          if (!m || typeof m !== 'object') continue
          const t = Date.parse(String(m.data || ''))
          const testo = typeof m.testo === 'string' ? m.testo.trim().slice(0, 4000) : ''
          const impronta = String(m.impronta || '')
          // niente date nel futuro o troppo vecchie, niente righe senza testo o senza impronta giusta
          if (!Number.isFinite(t) || t > adesso + 10 * 60000 || t < adesso - 40 * 864e5) continue
          if (!testo || !/^[0-9a-f]{64}$/.test(impronta) || viste.has(impronta)) continue
          viste.add(impronta)
          righe.push({
            gruppo_id: g.id, impronta, data: new Date(t).toISOString(),
            mittente: (typeof m.mittente === 'string' && m.mittente.trim() ? m.mittente.trim() : '?').slice(0, 120),
            direzione: m.direzione === 'out' ? 'out' : 'in',
            tipo: TIPI.includes(m.tipo) ? m.tipo : 'testo',
            testo, citazione: typeof m.citazione === 'string' && m.citazione.trim() ? m.citazione.trim().slice(0, 300) : null,
          })
        }
        let salvati = 0
        for (let i = 0; i < righe.length; i += 200) {
          const r = await rest('wa_gruppi_messaggi?on_conflict=gruppo_id,impronta&select=id', {
            method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(righe.slice(i, i + 200)),
          }) as { id: number }[] | null
          salvati += r?.length || 0
        }
        nuovi += salvati
        riga.arrivati = righe.length
        riga.nuovi = salvati
      }
      await rest(`wa_gruppi?id=eq.${g.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ ultimo_letto_il: new Date().toISOString(), ultimo_esito: riga }) })
      riepilogo.push(riga)
    }
    const falliti = riepilogo.filter((r) => r.letto !== true || r.ok === false)
    const errore = falliti.length ? `Gruppi non letti: ${falliti.map((r) => `${r.gruppo}${r.errore ? ` (${r.errore})` : ''}`).join('; ')}`.slice(0, 300) : null
    await registro(!errore, { nuovi, gruppi: riepilogo, letto_il: String(corpo.letto_il || '').slice(0, 40) }, errore)
    return risposta({ ok: !errore, nuovi, gruppi: riepilogo.map((r) => ({ gruppo: r.gruppo, nuovi: r.nuovi ?? 0, letto: r.letto })) })
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    try { await registro(false, null, errore) } catch { /* il registro non risponde: resta la risposta di errore */ }
    return risposta({ errore }, 500)
  }
})
