// WhatsApp (fase 7): Giovanni scrive dall'app a un contatto, con il suo numero WhatsApp Business.
// La chiama solo l'app, con l'accesso di Giovanni. Due tocchi: scrive (o approva una bozza) e conferma.
// Regola di Meta: un messaggio libero si può mandare solo entro 24 ore dall'ultimo messaggio
// ricevuto da quel contatto. Fuori finestra serve un modello approvato (a pagamento): qui si ferma e lo dice.
// Il messaggio mandato si salva in wa_messaggi (fonte 'app'); lo stato (consegnato, letto) lo aggiorna il webhook.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const GRAPH = 'https://graph.facebook.com/v26.0'
const FINESTRA = 24 * 3600 * 1000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const risposta = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)

  // Solo Giovanni.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
  const utente = u.ok ? await u.json() : null
  if (utente?.id !== UTENTE) return risposta({ errore: 'Non autorizzato' }, 401)

  const { wa_id, testo, bozza_id, risponde_a } = await req.json().catch(() => ({}))
  const corpo = String(testo || '').trim()
  if (!wa_id || !corpo) return risposta({ errore: 'Mancano destinatario o testo' }, 400)
  if (corpo.length > 4096) return risposta({ errore: 'Messaggio troppo lungo (max 4096 caratteri)' }, 400)

  try {
    const [col] = await rest('wa_collegamento?id=eq.1&select=token,phone_number_id') as Record<string, string>[]
    if (!col?.token || !col?.phone_number_id) return risposta({ errore: 'WhatsApp non è ancora collegato' }, 409)

    const [c] = await rest(`wa_contatti?wa_id=eq.${encodeURIComponent(wa_id)}&select=wa_id,ultimo_in_il`) as Record<string, string>[]
    if (!c) return risposta({ errore: 'Contatto WhatsApp sconosciuto' }, 404)
    if (!c.ultimo_in_il || Date.now() - new Date(c.ultimo_in_il).getTime() > FINESTRA) {
      return risposta({ errore: 'Sono passate più di 24 ore dal suo ultimo messaggio: WhatsApp permette solo un modello approvato. Scrivigli dal telefono.', serve_modello: true }, 409)
    }

    const r = await fetch(`${GRAPH}/${col.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${col.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual', to: wa_id, type: 'text',
        text: { body: corpo, preview_url: false },
        ...(risponde_a ? { context: { message_id: risponde_a } } : {}),
      }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return risposta({ errore: `WhatsApp: ${j?.error?.message || r.status}` }, 502)

    const id = j.messages?.[0]?.id
    if (id) {
      await rest('wa_messaggi', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify({ id, utente_id: UTENTE, wa_id, direzione: 'out', fonte: 'app', tipo: 'text', testo: corpo,
          risponde_a: risponde_a || null, data: new Date().toISOString(), stato: 'sent' }) })
    }
    if (bozza_id) {
      await rest(`bozze?id=eq.${bozza_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ stato: 'inviata', testo: corpo, inviata_il: new Date().toISOString() }) })
    }
    return risposta({ ok: true, id })
  } catch (e) {
    return risposta({ errore: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})
