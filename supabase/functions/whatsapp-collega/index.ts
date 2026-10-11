// WhatsApp (fase 7): completa l'aggancio del numero dopo l'iscrizione integrata di Meta (coesistenza).
// Riceve il codice dell'iscrizione + id dell'account WhatsApp Business e del numero, poi:
// 1. scambia il codice con il token (non scade; resta solo nel database, tabella senza permessi per l'app);
// 2. iscrive l'app all'account (così arrivano i webhook);
// 3. chiede a Meta i contatti della rubrica e lo storico 6 mesi (si può fare UNA sola volta, entro 24 ore).
// Si chiama con l'intestazione x-collega-token (segreto WA_COLLEGA_TOKEN). Non manda messaggi a nessuno.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_ID = '1050142621357706'
const GRAPH = 'https://graph.facebook.com/v26.0'

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}
const salva = (campi: Record<string, unknown>) =>
  rest('wa_collegamento?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })
const risposta = (dati: unknown, status = 200) => new Response(JSON.stringify(dati), { status, headers: { 'Content-Type': 'application/json' } })

async function graph(percorso: string, token: string, corpo?: unknown) {
  const r = await fetch(`${GRAPH}/${percorso}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${percorso.split('?')[0]}: ${j?.error?.message || r.status}`)
  return j
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)
  const atteso = Deno.env.get('WA_COLLEGA_TOKEN')
  if (!atteso || req.headers.get('x-collega-token') !== atteso) return risposta({ errore: 'Non autorizzato' }, 401)

  const { code, waba_id, phone_number_id, solo } = await req.json().catch(() => ({}))
  const fatto: Record<string, unknown> = {}
  try {
    let [col] = await rest('wa_collegamento?id=eq.1&select=*') as Record<string, any>[]
    let token: string = col?.token

    if (code) {
      const segreto = Deno.env.get('WA_APP_SECRET')
      if (!segreto) return risposta({ errore: 'Manca WA_APP_SECRET' }, 500)
      const q = new URLSearchParams({ client_id: APP_ID, client_secret: segreto, code })
      const r = await fetch(`${GRAPH}/oauth/access_token?${q}`)
      const j = await r.json()
      if (!j.access_token) return risposta({ errore: `Scambio codice: ${j?.error?.message || r.status}` }, 502)
      token = j.access_token
      await salva({ token, waba_id: waba_id || col?.waba_id, phone_number_id: phone_number_id || col?.phone_number_id,
        collegato_il: new Date().toISOString(), errore: null })
      fatto.token = 'salvato'
      ;[col] = await rest('wa_collegamento?id=eq.1&select=*') as Record<string, any>[]
    }
    if (!token || !col?.waba_id || !col?.phone_number_id) return risposta({ errore: 'Collegamento incompleto', fatto }, 400)

    if (!solo || solo === 'iscrivi') {
      await graph(`${col.waba_id}/subscribed_apps`, token, {})
      const n = await graph(`${col.phone_number_id}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type`, token)
      await salva({ numero: n.display_phone_number })
      fatto.numero = n
    }
    // Contatti e storico: Meta li manda via webhook (campi smb_app_state_sync e history).
    if ((!solo || solo === 'contatti') && !col.contatti_chiesti_il) {
      fatto.contatti = await graph(`${col.phone_number_id}/smb_app_data`, token, { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' })
      await salva({ contatti_chiesti_il: new Date().toISOString() })
    }
    if ((!solo || solo === 'storico') && !col.storico_chiesto_il) {
      fatto.storico = await graph(`${col.phone_number_id}/smb_app_data`, token, { messaging_product: 'whatsapp', sync_type: 'history' })
      await salva({ storico_chiesto_il: new Date().toISOString() })
    }
    return risposta({ ok: true, fatto })
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 400)
    await salva({ errore }).catch(() => {})
    return risposta({ errore, fatto }, 502)
  }
})
