import { createClient } from '@supabase/supabase-js'

// Chiave pubblica (publishable): può stare nell'app. I dati li protegge la RLS.
const SUPABASE_URL = 'https://vgurncqvgulldolhetyr.supabase.co'
const CHIAVE_PUBBLICA = 'sb_publishable_L1cVUg51REAtLemrf6KKlA_A0wUgUqx'

export const sb = createClient(SUPABASE_URL, CHIAVE_PUBBLICA, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

// Le tre aree (stesse righe della tabella public.aree). Tinte schiarite per il fondo scuro dell'app.
export const AREE = [
  { codice: 'C', nome: 'Ceramex', colore: '#5b93ff' },
  { codice: 'G', nome: 'G&C', colore: '#34d58a' },
  { codice: 'P', nome: 'Privato', colore: '#ff8f45' },
]
export const areaDa = (codice) => AREE.find((a) => a.codice === codice)

export const nomePersona = (p) => [p?.nome, p?.cognome].filter(Boolean).join(' ')

// Campi per riconoscere una persona: aree e ditte.
export const CAMPI_PERSONA = 'id,nome,cognome,persone_aree(area),persone_aziende(ruolo,aziende(id,nome,area))'

// "Ceramex, Gaffuri" · "G&C, Poretti Banci" · "Privato": una voce per area, con le ditte di quell'area.
export function etichettePersona(p) {
  const ditte = (p?.persone_aziende || []).map((x) => x.aziende).filter(Boolean)
  const aree = new Set([...(p?.persone_aree || []).map((x) => x.area), ...ditte.map((d) => d.area)])
  return AREE.filter((a) => aree.has(a.codice)).map((a) => ({
    area: a,
    testo: [a.nome, ...ditte.filter((d) => d.area === a.codice).map((d) => d.nome)].join(', '),
  }))
}

// Numero per WhatsApp (wa.me): "079 123 45 67" → "41791234567".
export function numeroWhatsApp(t) {
  const d = (t || '').replace(/\D/g, '')
  if (d.startsWith('00')) return d.slice(2)
  if (d.startsWith('0')) return '41' + d.slice(1)
  return d
}

function giorno(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// "oggi 14:30", "ieri 09:10", "12 ott", "12 ott 14:30" (conOra)
export function quando(iso, conOra = false) {
  if (!iso) return ''
  // "2026-10-09" (solo data, come le note clienti): niente ora.
  const soloData = iso.length === 10
  const d = new Date(soloData ? `${iso}T00:00` : iso)
  const ora = new Date()
  const diff = Math.round((giorno(d) - giorno(ora)) / 86400000)
  const hh = soloData ? '' : ' ' + d.toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })
  if (diff === 0) return `oggi${hh}`
  if (diff === -1) return `ieri${hh}`
  if (diff === 1) return `domani${hh}`
  const data = d.toLocaleDateString('it-CH', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== ora.getFullYear() ? { year: 'numeric' } : {}),
  })
  return conOra ? `${data}${hh}` : data
}

// Differenza in giorni di calendario tra una data e oggi (negativa = passata).
export function giorniDaOggi(iso) {
  return Math.round((giorno(new Date(iso)) - giorno(new Date())) / 86400000)
}

// localStorage può mancare (finestra privata ecc.): mai far cadere l'app per questo.
export function leggi(chiave) {
  try { return localStorage.getItem(chiave) } catch { return null }
}
export function scrivi(chiave, valore) {
  try { localStorage.setItem(chiave, valore) } catch { /* niente */ }
}
