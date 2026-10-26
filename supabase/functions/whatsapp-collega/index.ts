// WhatsApp (fase 7): completa l'aggancio del numero dopo l'iscrizione integrata di Meta (coesistenza).
// Riceve il codice dell'iscrizione + id dell'account WhatsApp Business e del numero, poi:
// 1. scambia il codice con il token (non scade; resta solo nel database, tabella senza permessi per l'app);
// 2. iscrive l'app all'account (così arrivano i webhook);
// 3. chiede a Meta i contatti della rubrica e lo storico 6 mesi (si può fare UNA sola volta, entro 24 ore).
// Si chiama con l'intestazione x-collega-token (segreto WA_COLLEGA_TOKEN) oppure, dal 26.10.2026, dalla pagina
// "Collega WhatsApp" dell'app con l'accesso di Giovanni (mai con un token dei connettori). Non manda messaggi a nessuno.
// Modo prova (per l'analisi dell'app di Meta): token_prova = token temporaneo del numero di prova di Meta.
// Salva quel numero e iscrive l'app, ma NON chiede contatti e storico (si fa una sola volta, col numero vero).
// Se l'iscrizione non manda waba_id / phone_number_id, li trova dal codice (debug_token → account → numeri).
import { daConnettore } from '../_shared/accesso.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
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
  const conChiave = !!atteso && req.headers.get('x-collega-token') === atteso
  let daApp = false
  if (!conChiave) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
    const utente = u.ok ? await u.json() : null
    if (utente?.id !== UTENTE || daConnettore(jwt)) return risposta({ errore: 'Non autorizzato' }, 401)
    daApp = true
  }

  const { code, token_prova, ...resto } = await req.json().catch(() => ({}))
  let { waba_id, phone_number_id } = resto
  // Dall'app solo l'iscrizione vera (codice), niente prove e niente "solo".
  if (daApp && (token_prova || !code)) return risposta({ errore: 'Dall\'app serve il codice dell\'iscrizione' }, 400)
  let solo: string | undefined = resto.solo
  const fatto: Record<string, unknown> = {}
  try {
    let [col] = await rest('wa_collegamento?id=eq.1&select=*') as Record<string, any>[]
    let token: string = col?.token

    if (token_prova) {
      if (!waba_id || !phone_number_id) return risposta({ errore: 'Per la prova servono waba_id e phone_number_id' }, 400)
      token = token_prova
      await salva({ token, waba_id, phone_number_id, collegato_il: new Date().toISOString(), errore: null })
      ;[col] = await rest('wa_collegamento?id=eq.1&select=*') as Record<string, any>[]
      fatto.prova = 'numero di prova salvato'
      solo = 'iscrivi'
    }

    if (code) {
      const segreto = Deno.env.get('WA_APP_SECRET')
      if (!segreto) return risposta({ errore: 'Manca WA_APP_SECRET' }, 500)
      const q = new URLSearchParams({ client_id: APP_ID, client_secret: segreto, code })
      const r = await fetch(`${GRAPH}/oauth/access_token?${q}`)
      const j = await r.json()
      if (!j.access_token) return risposta({ errore: `Scambio codice: ${j?.error?.message || r.status}` }, 502)
      token = j.access_token
      // Account e numero non arrivati dalla pagina: si leggono dai permessi del token appena avuto.
      if (!waba_id) {
        const d = await graph(`debug_token?input_token=${encodeURIComponent(token)}`, `${APP_ID}|${segreto}`)
        const scopi = (d?.data?.granular_scopes || []) as { scope: string, target_ids?: string[] }[]
        waba_id = scopi.find((s) => s.scope === 'whatsapp_business_management')?.target_ids?.[0]
          || scopi.find((s) => s.scope === 'whatsapp_business_messaging')?.target_ids?.[0]
        fatto.waba_trovato = !!waba_id
      }
      if (waba_id && !phone_number_id) {
        const nn = await graph(`${waba_id}/phone_numbers?fields=id,display_phone_number`, token)
        phone_number_id = nn?.data?.[0]?.id
      }
      // Mai tenere account o numero di prima (quello di prova) insieme al token nuovo.
      if (!waba_id || !phone_number_id) {
        await salva({ errore: 'Iscrizione: account o numero non trovati' })
        return risposta({ errore: 'Account WhatsApp o numero non trovati dopo l\'iscrizione', fatto }, 502)
      }
      await salva({ token, waba_id, phone_number_id, numero: null, collegato_il: new Date().toISOString(), errore: null })
      fatto.token = 'salvato'
      ;[col] = await rest('wa_collegamento?id=eq.1&select=*') as Record<string, any>[]
    }
    if (!token || !col?.waba_id || !col?.phone_number_id) return risposta({ errore: 'Collegamento incompleto', fatto }, 400)

    if (!solo || solo === 'iscrivi') {
      await graph(`${col.waba_id}/subscribed_apps`, token, {})
      const campi = token_prova ? 'display_phone_number,verified_name' : 'display_phone_number,verified_name,is_on_biz_app,platform_type'
      const n = await graph(`${col.phone_number_id}?fields=${campi}`, token)
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
