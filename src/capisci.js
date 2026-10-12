// Capire dal testo dettato nel + se va in una lista o se è una garanzia (13.10.2026). Niente intelligenza
// artificiale: frasi fisse, così è subito e si vede prima di salvare ("Va nella spesa: latte, pane").

const ARTICOLI = /^(?:il|lo|la|i|gli|le|un|uno|una|del|dello|della|dei|degli|delle|anche|poi|e)\s+/i
export const maiuscola = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
export const pulisci = (s) => maiuscola(s.trim().replace(/^(?:l'|un'|dell')/i, '').replace(ARTICOLI, '').replace(ARTICOLI, '').replace(/[.!?]+$/, '').trim())

const SPESA = /\b(?:nella|alla|in|sulla|per la)\s+(?:lista\s+(?:della|per la)\s+)?spesa\b/i
const SPESA_INIZIO = /^\s*(?:lista\s+(?:della\s+)?)?spesa\s*[:,-]\s*/i
const VERBI = /^\s*(?:metti|mettere|mettimi|aggiungi|aggiungere|aggiungimi|scrivi|segna|compra|comprare|prendi|prendere|ricordati di comprare)\b\s*/i
const RISTORANTI = /\b(?:nei|tra i|nella lista(?: dei)?|alla lista(?: dei)?)\s+(?:ristoranti|posti)(?:\s+e\s+posti)?\b/i
const LOCALE = /\b(?:ristorante|trattoria|pizzeria|osteria|grotto|locanda|agriturismo|sushi|enoteca)\b/i
const GIUDIZIO = /\b(?:consigliat[oa]|da provare|provat[oa]|ci siamo stati|siamo stati|voto|stelle)\b/i

// "metti il latte e il pane nella spesa" → spesa: Latte, Pane.
// "grotto del Mulino consigliato da Paolo" / "nei ristoranti: Da Mario a Lugano, voto 4" → ristoranti.
// Un ristorante senza "consigliato/provato/voto/da provare" resta una nota normale (può essere un appuntamento).
export function capisciLista(testo) {
  const t = (testo || '').trim()
  if (!t) return null
  if (SPESA_INIZIO.test(t) || SPESA.test(t)) {
    const resto = t.replace(SPESA_INIZIO, '').replace(SPESA, ' ').replace(VERBI, '').replace(/\b(?:da comprare|da prendere)\b/gi, '')
    const voci = resto.split(/,|;|\n|\s+e\s+|\s+poi\s+/i).map(pulisci).filter((v) => v && v.length < 60)
    if (voci.length) return { lista: 'spesa', voci: voci.map((v) => ({ testo: v })) }
  }
  if (RISTORANTI.test(t) || (LOCALE.test(t) && GIUDIZIO.test(t))) {
    const pulito = t.replace(RISTORANTI, '').replace(VERBI, '').replace(/^\s*[:,-]\s*/, '').trim()
    const v = pulito.match(/\bvoto\s*(\d+)(?:\s*\/\s*(\d+))?|(\d)\s*stell/i)
    let voto = v ? Number(v[1] || v[3]) : null
    if (voto != null && (Number(v[2]) === 10 || (!v[2] && voto > 5))) voto = Math.round(voto / 2)
    if (voto != null) voto = Math.min(5, Math.max(1, voto))
    const provato = voto != null || /\b(?:provat[oa]|ci siamo stati|siamo stati|mangiato)\b/i.test(pulito)
    // Il nome è la prima parte (fino alla virgola o a "consigliato/provato/voto…"); il resto sono i dettagli.
    const senzaVoto = pulito.replace(/,?\s*\bvoto\s*\d+(?:\s*\/\s*\d+)?|,?\s*\d\s*stelle?/gi, '')
    const [primo, ...altro] = senzaVoto.split(/,|\s+-\s+/)
    const taglio = primo.search(/\s(?:consigliat[oa]|da provare|provat[oa]|ci siamo stati|siamo stati)\b/i)
    const nome = (taglio > 0 ? primo.slice(0, taglio) : primo).trim()
    const dettagli = [taglio > 0 ? maiuscola(primo.slice(taglio).trim()) : '', ...altro.map((x) => x.trim())].filter(Boolean).join(', ')
    if (!nome) return null
    return { lista: 'ristoranti', voci: [{ testo: maiuscola(nome), dettagli: dettagli || null, voto, provato }] }
  }
  return null
}

const NEGOZI = /\b(?:Fust|Media ?Markt|Interdiscount|Digitec|Galaxus|Brack|Microspot|Melectronics|Manor|Coop|Migros|Ikea|Jumbo|Hornbach|Obi|Landi|Conforama|Pfister|Lipo|Apple|Amazon|Zalando|Decathlon|Ochsner|Mediaworld|Unieuro|Euronics)\b/i
const NUMERI = { un: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, dieci: 10 }
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// "garanzia lavatrice Fust 2 anni" → cosa "Lavatrice", negozio "Fust", 24 mesi, comprata oggi.
// Senza durata: 2 anni (la garanzia di legge in Svizzera). Con una data (12.9.2026) è il giorno dell'acquisto.
export function capisciGaranzia(testo, oggi = new Date()) {
  const t = (testo || '').trim()
  // Una domanda ("è ancora in garanzia?") non è una garanzia nuova.
  if (!/\bgaranzi[ae]\b/i.test(t) || /\?\s*$/.test(t) || /\b(?:ancora|è|e'|sono)\s+in\s+garanzia\b/i.test(t)) return null
  let mesi = 24
  const d = t.match(/\b(\d+|un|uno|due|tre|quattro|cinque|sei|dieci)\s+(anni|anno|mesi|mese)\b/i)
  if (d) {
    const n = NUMERI[d[1].toLowerCase()] || Number(d[1])
    if (n > 0) mesi = Math.min(240, /ann/i.test(d[2]) ? n * 12 : n)
  }
  let comprata = oggi
  const dt = t.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/)
  if (dt) {
    const anno = dt[3] ? (dt[3].length === 2 ? 2000 + Number(dt[3]) : Number(dt[3])) : oggi.getFullYear()
    const c = new Date(anno, Number(dt[2]) - 1, Number(dt[1]))
    if (!Number.isNaN(c.getTime()) && c <= oggi) comprata = c
  }
  // Negozio: i soliti negozi, oppure "da/presso <Nome>" con la maiuscola.
  const trovato = t.match(NEGOZI)?.[0] || t.match(/\b(?:da|presso|comprat[oa] da|comprat[oa] a)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)?)/)?.[1] || null
  const negozio = trovato ? maiuscola(trovato) : null
  let cosa = t.replace(/\b(?:la\s+)?garanzi[ae]\b\s*(?:di|del|della|dello|dei|delle|per|sul|sulla)?/i, ' ')
  if (d) cosa = cosa.replace(d[0], ' ')
  if (dt) cosa = cosa.replace(dt[0], ' ')
  if (trovato) cosa = cosa.replace(new RegExp(`(?:\\b(?:da|presso|comprat[oa] da|comprat[oa] a)\\s+)?${escape(trovato)}`, 'i'), ' ')
  cosa = cosa.replace(/\b(?:comprat[oa]|acquistat[oa])(?:\s+il)?\b/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s,:.-]+|[\s,:.-]+$/g, '')
  // Parole rimaste appese alla fine ("Aspirapolvere Dyson il").
  for (let i = 0; i < 3; i++) cosa = cosa.replace(/[\s,]+(?:il|lo|la|del|della|da|a|in|presso|di|con)$/i, '')
  cosa = pulisci(cosa)
  const iso = `${comprata.getFullYear()}-${String(comprata.getMonth() + 1).padStart(2, '0')}-${String(comprata.getDate()).padStart(2, '0')}`
  const fine = new Date(comprata); fine.setMonth(fine.getMonth() + mesi)
  return { cosa: cosa || 'Garanzia', negozio, mesi, comprata_il: iso, fine }
}

export const durata = (mesi) => (mesi % 12 === 0 ? (mesi === 12 ? '1 anno' : `${mesi / 12} anni`) : `${mesi} mesi`)
