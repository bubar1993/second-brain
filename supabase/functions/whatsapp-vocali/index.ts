// WhatsApp (fase 7): porta per trascrivere le note vocali sul PC di Giovanni (Whisper sulla scheda video, gratis).
// Si chiama con l'intestazione x-trascrivi-token (segreto TRASCRIVI_TOKEN). Lo script è scripts/trascrivi-vocali.py.
// - GET                → note vocali da trascrivere (ultimi 30 giorni: dopo Meta cancella il file)
// - GET ?audio=<id>    → il file audio, scaricato da Meta col token del collegamento (il token non esce mai)
// - POST {id, testo}   → salva la trascrizione nel testo; vista_il torna vuoto così gli agenti la rileggono
// - POST {id, errore}  → segna che non si è potuta fare (non si riprova)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GRAPH = 'https://graph.facebook.com/v26.0'

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}
const risposta = (dati: unknown, status = 200) => new Response(JSON.stringify(dati), { status, headers: { 'Content-Type': 'application/json' } })
const aggiorna = (id: string, campi: Record<string, unknown>) =>
  rest(`wa_messaggi?id=eq.${encodeURIComponent(id)}&tipo=eq.audio`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })

Deno.serve(async (req: Request) => {
  const atteso = Deno.env.get('TRASCRIVI_TOKEN')
  if (!atteso || req.headers.get('x-trascrivi-token') !== atteso) return risposta({ errore: 'Non autorizzato' }, 401)
  const url = new URL(req.url)
  try {
    if (req.method === 'GET') {
      const id = url.searchParams.get('audio')
      if (!id) {
        const da = new Date(Date.now() - 30 * 864e5).toISOString()
        const righe = await rest(`wa_messaggi?tipo=eq.audio&trascrizione=is.null&data=gte.${da}&select=id,media,data&order=data.asc&limit=20`) as
          { id: string; media: Record<string, any> | null; data: string }[]
        return risposta(righe.map((r) => ({ id: r.id, mime: r.media?.mime || null, data: r.data })))
      }
      const [m] = await rest(`wa_messaggi?id=eq.${encodeURIComponent(id)}&tipo=eq.audio&select=media`) as { media: Record<string, any> | null }[]
      if (!m?.media?.id) return risposta({ errore: 'Nessun file per questo messaggio' }, 404)
      const [col] = await rest('wa_collegamento?id=eq.1&select=token') as { token: string | null }[]
      if (!col?.token) return risposta({ errore: 'WhatsApp non collegato' }, 409)
      const auth = { Authorization: `Bearer ${col.token}` }
      const info = await fetch(`${GRAPH}/${m.media.id}`, { headers: auth }).then((r) => r.json()).catch(() => ({}))
      if (!info?.url) return risposta({ errore: `Meta: ${info?.error?.message || 'file non trovato'}` }, 502)
      const file = await fetch(info.url, { headers: auth })
      if (!file.ok) return risposta({ errore: `Download ${file.status}` }, 502)
      return new Response(file.body, { headers: { 'Content-Type': info.mime_type || m.media.mime || 'audio/ogg' } })
    }
    if (req.method === 'POST') {
      const { id, testo, errore } = await req.json().catch(() => ({}))
      if (!id) return risposta({ errore: 'Manca id' }, 400)
      if (typeof testo === 'string' && testo.trim()) {
        await aggiorna(id, { testo: testo.trim().slice(0, 8000), trascrizione: 'fatta', vista_il: null, esito: null, motivo: null })
      } else {
        await aggiorna(id, { trascrizione: `errore: ${String(errore || 'vuota').slice(0, 200)}` })
      }
      return risposta({ ok: true })
    }
    return risposta({ errore: 'Usa GET o POST' }, 405)
  } catch (e) {
    return risposta({ errore: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})
