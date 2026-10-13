// Senza rete (garage, cantiere, supermercato): note e spesa restano sul telefono e partono da sole quando torna la rete
// (14.10.2026, ok di Giovanni). Ogni cosa ha già il suo id, così se una parte due volte non diventa doppia.
import { sb, leggi, scrivi } from './supabase'

const CHIAVE = 'coda-senza-rete'

// Errore "già c'è" (stesso id già salvato): per la coda vuol dire che era già partita.
export const giaFatto = (error) => error?.code === '23505'
const ok = ({ error }) => { if (error && !giaFatto(error)) throw error }

const lavori = { // tipo → async (dati) => void ('nota' lo registra Aggiungi)
  lista_voci: async (voci) => ok(await sb.from('liste_voci').insert(voci)),
  spesa_presa: async ({ id, fatta_il }) => ok(await sb.from('liste_voci').update({ fatta_il }).eq('id', id)),
}

export const senzaRete = (e) => (typeof navigator !== 'undefined' && !navigator.onLine)
  || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(String(e?.message || e || ''))

function leggiCoda() {
  try { return JSON.parse(leggi(CHIAVE) || '[]') } catch { return [] }
}

export const inCoda = () => leggiCoda().length

export function mettiInCoda(tipo, dati) {
  scrivi(CHIAVE, JSON.stringify([...leggiCoda(), { tipo, dati, ora: Date.now() }]))
  window.dispatchEvent(new Event('coda-cambiata'))
}

// Chi sa fare un tipo di lavoro lo registra qui (Aggiungi: 'nota').
export function registraLavoro(tipo, fn) { lavori[tipo] = fn }

let inCorso = false
// Manda quello che è in coda, in ordine. Se manca ancora la rete si ferma e riprova al prossimo "online".
export async function svuotaCoda() {
  if (inCorso || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0
  inCorso = true
  let fatti = 0
  try {
    for (;;) {
      const [primo] = leggiCoda()
      if (!primo) break
      const fn = lavori[primo.tipo]
      if (!fn) break // la schermata che lo sa fare non è ancora caricata: riprovo dopo
      try {
        await fn(primo.dati)
      } catch (e) {
        if (senzaRete(e)) break
        // Errore vero (dato rifiutato): non blocca la coda per sempre.
        console.warn('Coda senza rete: scartato', primo, e)
      }
      scrivi(CHIAVE, JSON.stringify(leggiCoda().slice(1)))
      fatti++
    }
  } finally {
    inCorso = false
    window.dispatchEvent(new Event('coda-cambiata'))
  }
  return fatti
}
