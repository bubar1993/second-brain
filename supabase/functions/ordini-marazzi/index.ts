// Conferme d'ordine Marazzi (12.10.2026): ogni 15 minuti (pg_cron) cerca nella Gmail di Giovanni le conferme
// automatiche di Marazzi (italiano, inglese, tedesco, francese), scarica il PDF e ne salva il testo in
// ordini_marazzi. Niente intelligenza artificiale qui: cliente, righe e disponibilità li legge poi la routine
// "Ordini Marazzi". Solo lettura della Gmail (permesso gmail.readonly), non cambia niente nella casella.
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
// Le conferme vere: mittente Marazzi, numero d'ordine 2026… nell'oggetto, niente inoltri o risposte.
const CERCA = 'from:marazzigroup.com has:attachment filename:pdf newer_than:3d'
const PAROLE = /(ordine|order|auftrag|bestellung|commande|conferm|confirm|bestätigung)/i
const INOLTRO = /^\s*(i|r|re|aw|wg|tr|fw|fwd|rif)\s*:/i
const NUMERO = /\b20\d{9}\b/g
// Si parte dal 12.10.2026 (scelta di Giovanni: niente conferme più vecchie).
const DAL = Date.parse('2026-10-11T22:00:00Z')

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}

async function accesso() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GMAIL_CLIENT_ID')!, client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GMAIL_REFRESH_TOKEN')!, grant_type: 'refresh_token',
    }),
  })
  const t = await r.json()
  if (!t.access_token) throw new Error(`Collegamento Gmail non valido (${t.error || r.status})`)
  return t.access_token as string
}

async function gmail(token: string, percorso: string) {
  const r = await fetch(`${GMAIL}/${percorso}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

type Parte = { filename?: string; mimeType?: string; body?: { attachmentId?: string; data?: string }; parts?: Parte[]; headers?: { name: string; value: string }[] }
const intestazione = (p: Parte, nome: string) => p.headers?.find((h) => h.name.toLowerCase() === nome.toLowerCase())?.value || ''
const pdfDi = (p: Parte): Parte[] => [
  ...((p.filename || '').toLowerCase().endsWith('.pdf') || p.mimeType === 'application/pdf' ? [p] : []),
  ...(p.parts || []).flatMap(pdfDi),
]
const daBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const indirizzi = (s: string) => [...new Set((s.match(/[^\s<>",;]+@[^\s<>",;]+/g) || []).map((x) => x.toLowerCase()))]

// Riferimento del cliente dall'oggetto: "PO Bardarelli", "Vs rif. ordine MEK5", "Ihre Bestellung …", "Votre réf. …".
function riferimento(oggetto: string) {
  const m = oggetto.match(/(?:\bPO\b|Vs\.? rif\.?(?: ordine)?|Ihre? (?:Bestellung|Ref\.?|Referenz)|Votre (?:r[ée]f\.?|r[ée]f[ée]rence|commande))\s*:?\s*(.+?)\s+-\s+/i)
  return m ? m[1].trim() : null
}

async function leggi() {
  const token = await accesso()
  const elenco = await gmail(token, `messages?maxResults=50&q=${encodeURIComponent(CERCA)}`)
  const ids: string[] = (elenco.messages || []).map((m: { id: string }) => m.id)
  if (!ids.length) return { trovate: 0, nuove: 0 }
  const gia = new Set((await rest(`ordini_marazzi?select=gmail_message_id&gmail_message_id=in.(${ids.join(',')})`) as { gmail_message_id: string }[])
    .map((r) => r.gmail_message_id))

  let nuove = 0
  const errori: string[] = []
  for (const id of ids.filter((x) => !gia.has(x)).slice(0, 20)) {
    try {
      const m = await gmail(token, `messages/${id}?format=full`)
      const p = m.payload as Parte
      const oggetto = intestazione(p, 'Subject')
      const numeri = [...new Set(oggetto.match(NUMERO) || [])]
      if (Number(m.internalDate) < DAL || INOLTRO.test(oggetto) || !numeri.length || !PAROLE.test(oggetto)) continue
      const pdf = pdfDi(p)
      let testo = ''
      for (const a of pdf) {
        const dati = a.body?.attachmentId
          ? daBase64Url((await gmail(token, `messages/${id}/attachments/${a.body.attachmentId}`)).data)
          : a.body?.data ? daBase64Url(a.body.data) : null
        if (!dati) continue
        const doc = await getDocumentProxy(dati)
        const { text } = await extractText(doc, { mergePages: true })
        // Dopo il totale ci sono solo le condizioni di vendita: non servono.
        let t = String(text)
        const fine = t.lastIndexOf('TOTAL NET AMOUNT')
        if (fine > 0) t = t.slice(0, fine + 40)
        testo += (testo ? '\n\n' : '') + t.slice(0, 40000)
      }
      // Il riferimento del cliente è scritto meglio nel PDF che nell'oggetto.
      const rifPdf = testo.match(/CUST\. ORD\. NUMBER:\s*(.+?)\s+SHIPMENT PRIORITY/)?.[1]?.trim()
      await rest('ordini_marazzi?on_conflict=gmail_message_id', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({
          utente_id: UTENTE, gmail_message_id: id, gmail_thread_id: m.threadId,
          data: new Date(Number(m.internalDate)).toISOString(), oggetto,
          destinatari: indirizzi(intestazione(p, 'To')), numeri, riferimento: rifPdf || riferimento(oggetto),
          nome_pdf: pdf.map((a) => a.filename).filter(Boolean).join(', ') || null,
          testo_pdf: testo || null,
          stato: testo ? 'da_leggere' : 'errore', errore: testo ? null : 'PDF non trovato o non leggibile',
        }),
      })
      nuove++
    } catch (e) {
      errori.push(String((e as Error)?.message || e).slice(0, 150))
    }
  }
  if (errori.length && !nuove) throw new Error(errori[0])
  return { trovate: ids.length, nuove, errori: errori.length }
}

Deno.serve(async (req: Request) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) return new Response('Non autorizzato', { status: 401 })
  const iniziata_il = new Date().toISOString()
  let esito
  try {
    esito = { ok: true, dettagli: await leggi(), errore: null }
  } catch (e) {
    esito = { ok: false, dettagli: null, errore: String((e as Error)?.message || e).slice(0, 500) }
  }
  // Nel registro solo se ha trovato qualcosa di nuovo o se c'è un errore (ogni 15 minuti sarebbero troppe righe).
  if (!esito.ok || (esito.dettagli as { nuove?: number })?.nuove) {
    await rest('lavori_registro', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ lavoro: 'ordini-marazzi', iniziata_il, ...esito }) }).catch(() => {})
  }
  return new Response(JSON.stringify(esito), { status: esito.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
})
