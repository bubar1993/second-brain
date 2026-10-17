// WhatsApp (fase 7): modelli di messaggio del numero WhatsApp Business.
// Un modello approvato da Meta serve per scrivere a chi non ha scritto nelle ultime 24 ore.
// La chiama solo l'app, con l'accesso di Giovanni.
// - GET: elenco dei modelli con lo stato (in attesa, approvato, rifiutato).
// - POST { nome, categoria, testo }: crea un modello in italiano (Meta lo controlla, di solito in pochi minuti).
// Creare un modello è gratis; si paga solo quando lo si manda fuori dalle 24 ore.

import { daConnettore } from '../_shared/accesso.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const GRAPH = 'https://graph.facebook.com/v26.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const risposta = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Solo Giovanni.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
  const utente = u.ok ? await u.json() : null
  if (utente?.id !== UTENTE || daConnettore(jwt)) return risposta({ errore: 'Non autorizzato' }, 401)

  const r0 = await fetch(`${SUPABASE_URL}/rest/v1/wa_collegamento?id=eq.1&select=token,waba_id`, { headers: sbHeaders })
  const [col] = r0.ok ? await r0.json() : []
  if (!col?.token || !col?.waba_id) return risposta({ errore: 'WhatsApp non è ancora collegato' }, 409)
  const auth = { Authorization: `Bearer ${col.token}`, 'Content-Type': 'application/json' }

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${GRAPH}/${col.waba_id}/message_templates?fields=name,status,category,language,components,rejected_reason&limit=100`, { headers: auth })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return risposta({ errore: `WhatsApp: ${j?.error?.message || r.status}` }, 502)
      return risposta({ modelli: (j.data || []).map((m: any) => ({
        id: m.id, nome: m.name, stato: m.status, categoria: m.category, lingua: m.language,
        testo: m.components?.find((c: any) => c.type === 'BODY')?.text || '', motivo: m.rejected_reason,
      })) })
    }

    const { nome, categoria, testo } = await req.json().catch(() => ({}))
    const corpo = String(testo || '').trim()
    // Nome come lo vuole Meta: minuscole, cifre e trattini bassi.
    const nomeMeta = String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 512)
    if (!nomeMeta || !corpo) return risposta({ errore: 'Servono nome e testo' }, 400)
    if (corpo.length > 1024) return risposta({ errore: 'Testo troppo lungo (max 1024 caratteri)' }, 400)
    const cat = categoria === 'MARKETING' ? 'MARKETING' : 'UTILITY'

    // {{1}}, {{2}}…: Meta vuole un esempio per ogni segnaposto.
    const segnaposti = [...new Set(corpo.match(/\{\{\d+\}\}/g) || [])]
    const body: Record<string, unknown> = { type: 'BODY', text: corpo }
    if (segnaposti.length) body.example = { body_text: [segnaposti.map((_, i) => ['Mario', 'martedì', '10:00', 'Manno'][i] || `esempio ${i + 1}`)] }

    const r = await fetch(`${GRAPH}/${col.waba_id}/message_templates`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: nomeMeta, category: cat, language: 'it', components: [body] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return risposta({ errore: `WhatsApp: ${j?.error?.error_user_msg || j?.error?.message || r.status}` }, 502)
    return risposta({ ok: true, id: j.id, stato: j.status, nome: nomeMeta })
  } catch (e) {
    return risposta({ errore: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})
