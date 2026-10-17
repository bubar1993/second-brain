// Rubrica: i contatti Google di giovannifabris@ceramex.ch (quelli del telefono) nei due sensi. 13.10.2026, ok di Giovanni.
// Google Contatti si sincronizza da solo col telefono: quello che si cambia qui arriva sul telefono in pochi minuti.
// Azioni:
//   { azione: 'sincronizza' }                → legge da Google le novità (pg_cron ogni 15 min, x-copia-token; o Giovanni),
//                                             abbina a persone e ditte (rubrica_abbina) e, se acceso, aggiunge in Google
//                                             le persone di lavoro che mancano ("Nome Cognome (Ditta)");
//   { azione: 'salva', id?, campi }          → crea o corregge un contatto (e la persona collegata);
//   { azione: 'salva', persona_id }          → dopo una modifica nella scheda persona: la porta in Google se è collegata;
//   { azione: 'elimina', id }                → elimina da Google (resta la copia qui);
//   { azione: 'ripristina', id }             → lo ricrea in Google dalla copia.
// Collegamento: client "Second Brain Gmail" (GMAIL_CLIENT_ID/SECRET) con un permesso a parte solo per i contatti
// (CONTATTI_REFRESH_TOKEN, `node scripts/collega-contatti.mjs`). Non tocca la Gmail.

import { daConnettore } from '../_shared/accesso.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const PEOPLE = 'https://people.googleapis.com/v1'
const CAMPI = 'names,emailAddresses,phoneNumbers,organizations,birthdays,biographies,metadata'
const SENZA_ANNO = 1904

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
// Tutte le righe (il database ne dà al massimo 1000 per volta).
async function tutte(percorso: string) {
  const tutto: Record<string, any>[] = []
  for (let da = 0; ; da += 1000) {
    const pezzo = await rest(`${percorso}&order=id&limit=1000&offset=${da}`) as Record<string, any>[]
    tutto.push(...pezzo)
    if (pezzo.length < 1000) return tutto
  }
}
const patch = (percorso: string, campi: Record<string, unknown>) =>
  rest(percorso, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })

async function accesso() {
  const refresh = Deno.env.get('CONTATTI_REFRESH_TOKEN')
  if (!refresh) throw new Error('Rubrica non ancora collegata a Google: va fatto dal PC')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GMAIL_CLIENT_ID')!, client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const t = await r.json()
  if (!t.access_token) throw new Error(`collegamento Google Contatti non valido (${t.error || r.status}): va rifatto dal PC`)
  return t.access_token as string
}
async function google(token: string, percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${PEOPLE}/${percorso}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
  if (r.status === 410) return { scaduto: true }
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Google Contatti ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.status === 204 ? {} : r.json()
}

// --- Google ↔ riga della rubrica ---
type Riga = Record<string, any>
const primo = (lista: any[] | undefined) => (lista || []).find((x) => x.metadata?.primary) || (lista || [])[0]

function daGoogle(p: any): Riga {
  const n = primo(p.names) || {}
  const o = primo(p.organizations) || {}
  const b = (p.birthdays || []).find((x: any) => x.date?.month && x.date?.day)?.date
  const due = (x: number) => String(x).padStart(2, '0')
  return {
    risorsa: p.resourceName, etag: p.etag,
    nome: n.givenName || (!n.familyName ? n.displayName : null) || null,
    cognome: n.familyName || null,
    ditta: o.name || null, ruolo: o.title || null,
    telefoni: (p.phoneNumbers || []).map((t: any) => ({ valore: t.value, tipo: t.formattedType || t.type || null, e164: t.canonicalForm || null })),
    email: (p.emailAddresses || []).map((e: any) => ({ valore: e.value, tipo: e.formattedType || e.type || null })),
    compleanno: b ? `${b.year || SENZA_ANNO}-${due(b.month)}-${due(b.day)}` : null,
    appunti: primo(p.biographies)?.value || null,
    aggiornata_il: primo(p.metadata?.sources)?.updateTime || new Date().toISOString(),
  }
}

// Solo i campi che l'app gestisce; il resto del contatto in Google (foto, indirizzi…) non si tocca.
function versoGoogle(c: Riga) {
  const p: Record<string, unknown> = {
    names: [{ givenName: c.nome || '', familyName: c.cognome || '' }],
    organizations: c.ditta || c.ruolo ? [{ name: c.ditta || '', title: c.ruolo || '' }] : [],
    phoneNumbers: (c.telefoni || []).filter((t: any) => t.valore?.trim()).map((t: any) => ({ value: t.valore.trim(), type: tipoGoogle(t.tipo, 'mobile') })),
    emailAddresses: (c.email || []).filter((e: any) => e.valore?.trim()).map((e: any) => ({ value: e.valore.trim(), type: tipoGoogle(e.tipo, 'work') })),
    biographies: c.appunti ? [{ value: c.appunti, contentType: 'TEXT_PLAIN' }] : [],
    birthdays: [],
  }
  if (c.compleanno) {
    const [a, m, g] = String(c.compleanno).split('-').map(Number)
    p.birthdays = [{ date: { ...(a && a !== SENZA_ANNO ? { year: a } : {}), month: m, day: g } }]
  }
  return p
}
// Google accetta i tipi in inglese (mobile, home, work, other…): quelli italiani mostrati dall'app tornano indietro così.
const TIPI: Record<string, string> = { cellulare: 'mobile', casa: 'home', lavoro: 'work', ufficio: 'work', altro: 'other', principale: 'main' }
function tipoGoogle(tipo: string | null | undefined, base: string) {
  if (!tipo) return base
  const t = tipo.toLowerCase()
  return TIPI[t] || t
}

// --- Lettura da Google ---
async function sincronizza() {
  const token = await accesso()
  const [stato] = await rest(`rubrica_stato?utente_id=eq.${UTENTE}&select=*`) as Riga[]
  let syncToken = stato?.sync_token as string | null
  let completa = !syncToken
  const visti = new Set<string>()
  const righe: Riga[] = []
  const tolti: string[] = []
  let pagina = ''
  let prossimo: string | null = null
  for (let giri = 0; giri < 50; giri++) {
    const q = new URLSearchParams({ personFields: CAMPI, pageSize: '1000', requestSyncToken: 'true' })
    if (pagina) q.set('pageToken', pagina)
    if (syncToken) q.set('syncToken', syncToken)
    const r = await google(token, `people/me/connections?${q}`)
    if (r?.scaduto) { // il segno di Google è scaduto (dopo 7 giorni): si rilegge tutto
      syncToken = null; completa = true; pagina = ''; righe.length = 0; tolti.length = 0; visti.clear()
      continue
    }
    for (const p of r?.connections || []) {
      if (p.metadata?.deleted) { tolti.push(p.resourceName); continue }
      visti.add(p.resourceName)
      righe.push({ ...daGoogle(p), utente_id: UTENTE, eliminata_il: null })
    }
    pagina = r?.nextPageToken || ''
    if (!pagina) { prossimo = r?.nextSyncToken || null; break }
  }

  for (let i = 0; i < righe.length; i += 500) {
    await rest('rubrica?on_conflict=risorsa', { method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(righe.slice(i, i + 500)) })
  }
  // Eliminati in Google (o sul telefono): restano qui come eliminati, con la copia.
  const ora = new Date().toISOString()
  for (let i = 0; i < tolti.length; i += 100) {
    const lista = tolti.slice(i, i + 100).map((x) => `"${x}"`).join(',')
    await patch(`rubrica?risorsa=in.(${lista})&eliminata_il=is.null`, { eliminata_il: ora })
  }
  if (completa) {
    const presenti = await tutte(`rubrica?utente_id=eq.${UTENTE}&eliminata_il=is.null&risorsa=not.is.null&select=id,risorsa`) as Riga[]
    const via = presenti.filter((x) => !visti.has(x.risorsa)).map((x) => x.id)
    for (let i = 0; i < via.length; i += 100) await patch(`rubrica?id=in.(${via.slice(i, i + 100).join(',')})`, { eliminata_il: ora })
  }

  const abbinate = await rest('rpc/rubrica_abbina', { method: 'POST', body: '{}' })
  const aggiunte = stato?.aggiungi_lavoro ? await aggiungiLavoro(token) : 0
  const esito = { lette: righe.length, eliminate: tolti.length, completa, ...abbinate, aggiunte_in_google: aggiunte }
  await rest('rubrica_stato?on_conflict=utente_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ utente_id: UTENTE, sync_token: prossimo || syncToken, ultimo_giro: ora, esito }) })
  return esito
}

// Persone di Ceramex e G&C con mail o telefono che sul telefono non ci sono (mai state: chi è stato eliminato non torna).
async function aggiungiLavoro(token: string) {
  const persone = await tutte(`persone?utente_id=eq.${UTENTE}&eliminata_il=is.null&or=(email.not.is.null,telefono.not.is.null)` +
    '&select=id,nome,cognome,telefono,email,email_altre,compleanno,ruolo,persone_aziende(ruolo,aziende(nome,area,eliminata_il,unito_in)),rubrica(id)') as Riga[]
  const mancanti = persone.filter((p) => !p.rubrica?.length && p.persone_aziende.some((x: Riga) =>
    x.aziende && !x.aziende.eliminata_il && !x.aziende.unito_in && ['C', 'G'].includes(x.aziende.area)))
  let fatte = 0
  for (let i = 0; i < mancanti.length; i += 100) {
    const gruppo = mancanti.slice(i, i + 100)
    const contatti = gruppo.map((p) => {
      const d = p.persone_aziende.find((x: Riga) => x.aziende && ['C', 'G'].includes(x.aziende.area))
      const ditta = d.aziende.nome
      return { p, ditta, area: d.aziende.area, c: {
        nome: p.nome, cognome: [p.cognome, `(${ditta})`].filter(Boolean).join(' '), ditta, ruolo: d.ruolo || p.ruolo,
        telefoni: p.telefono ? [{ valore: p.telefono, tipo: 'work' }] : [],
        email: [p.email, ...(p.email_altre || [])].filter(Boolean).map((e: string) => ({ valore: e, tipo: 'work' })),
        compleanno: p.compleanno,
      } }
    })
    const r = await google(token, 'people:batchCreateContacts', { method: 'POST',
      body: JSON.stringify({ contacts: contatti.map((x) => ({ contactPerson: versoGoogle(x.c) })), readMask: CAMPI }) })
    const create = (r?.createdPeople || []) as Riga[]
    const righe = create.map((x, k) => x.person && ({ ...daGoogle(x.person), utente_id: UTENTE, persona_id: contatti[k].p.id,
      area: contatti[k].area, origine: 'brain', esaminata_il: new Date().toISOString() })).filter(Boolean)
    if (righe.length) await rest('rubrica?on_conflict=risorsa', { method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(righe) })
    fatte += righe.length
  }
  return fatte
}

// --- Scrittura ---
const pulito = (c: Riga) => ({
  nome: String(c.nome || '').trim() || null,
  cognome: String(c.cognome || '').trim() || null,
  ditta: String(c.ditta || '').trim() || null,
  ruolo: String(c.ruolo || '').trim() || null,
  telefoni: (Array.isArray(c.telefoni) ? c.telefoni : []).filter((t: any) => String(t?.valore || '').trim()).slice(0, 10),
  email: (Array.isArray(c.email) ? c.email : []).filter((e: any) => String(e?.valore || '').trim()).slice(0, 10),
  compleanno: /^\d{4}-\d{2}-\d{2}$/.test(String(c.compleanno || '')) ? c.compleanno : null,
  appunti: String(c.appunti || '').trim() || null,
})

async function salva(token: string, id: string | null, campi: Riga, area: string | null) {
  const c = pulito(campi)
  if (!c.nome && !c.cognome && !c.ditta) throw new Error('Serve almeno un nome')
  let riga: Riga | null = null
  if (id) {
    ;[riga] = await rest(`rubrica?id=eq.${id}&utente_id=eq.${UTENTE}&select=*`) as Riga[]
    if (!riga) throw new Error('Contatto sconosciuto')
  }
  let p: any
  if (riga?.risorsa && !riga.eliminata_il) {
    // Sempre l'ultima versione (etag), così non si cancella quello che è cambiato sul telefono nel frattempo.
    const ora = await google(token, `${riga.risorsa}?personFields=${CAMPI}`)
    if (!ora) throw new Error('Il contatto non c\'è più in Google')
    const q = new URLSearchParams({ updatePersonFields: 'names,organizations,phoneNumbers,emailAddresses,biographies,birthdays', personFields: CAMPI })
    p = await google(token, `${riga.risorsa}:updateContact?${q}`, { method: 'PATCH', body: JSON.stringify({ ...versoGoogle(c), etag: ora.etag }) })
  } else {
    p = await google(token, `people:createContact?personFields=${CAMPI}`, { method: 'POST', body: JSON.stringify(versoGoogle(c)) })
  }
  const nuova = { ...daGoogle(p), utente_id: UTENTE, eliminata_il: null }
  if (riga) await patch(`rubrica?id=eq.${riga.id}`, nuova)
  else {
    ;[riga] = await rest('rubrica', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...nuova, area: ['C', 'G', 'P'].includes(String(area)) ? area : 'P', origine: 'brain', esaminata_il: new Date().toISOString() }) }) as Riga[]
  }
  // La persona collegata segue: nome, telefono, mail, compleanno.
  if (riga?.persona_id) {
    await patch(`persone?id=eq.${riga.persona_id}`, {
      nome: c.nome || c.cognome, cognome: c.nome ? (c.cognome || '').replace(/\s*\([^)]*\)\s*$/, '') || null : null,
      telefono: c.telefoni[0]?.valore || null, email: c.email[0]?.valore?.toLowerCase() || null, compleanno: c.compleanno,
    })
  }
  return { id: riga!.id }
}

// Dalla scheda persona: nome, telefono, mail e compleanno vanno nel contatto collegato (il resto del contatto resta).
async function salvaPersona(token: string, personaId: string) {
  const [riga] = await rest(`rubrica?persona_id=eq.${personaId}&eliminata_il=is.null&utente_id=eq.${UTENTE}&select=*`) as Riga[]
  if (!riga) return { collegata: false }
  const [p] = await rest(`persone?id=eq.${personaId}&select=nome,cognome,telefono,email,compleanno`) as Riga[]
  const ditta = String(riga.cognome || '').match(/\(([^)]+)\)\s*$/)?.[1]
  const telefoni = riga.telefoni as Riga[]
  const email = riga.email as Riga[]
  const campi = {
    ...riga,
    nome: p.nome, cognome: [p.cognome, ditta ? `(${ditta})` : null].filter(Boolean).join(' ') || null,
    telefoni: p.telefono && !telefoni.some((t) => t.valore === p.telefono) ? [{ valore: p.telefono, tipo: 'mobile' }, ...telefoni] : telefoni,
    email: p.email && !email.some((e) => String(e.valore).toLowerCase() === p.email.toLowerCase()) ? [{ valore: p.email, tipo: 'work' }, ...email] : email,
    compleanno: p.compleanno || riga.compleanno,
  }
  // Senza toccare di nuovo la persona (è appena stata salvata lei).
  const c = pulito(campi)
  const ora = await google(token, `${riga.risorsa}?personFields=${CAMPI}`)
  if (!ora) return { collegata: false }
  const q = new URLSearchParams({ updatePersonFields: 'names,phoneNumbers,emailAddresses,birthdays', personFields: CAMPI })
  const nuovo = await google(token, `${riga.risorsa}:updateContact?${q}`, { method: 'PATCH', body: JSON.stringify({ ...versoGoogle(c), etag: ora.etag }) })
  await patch(`rubrica?id=eq.${riga.id}`, daGoogle(nuovo))
  return { collegata: true }
}

async function elimina(token: string, id: string) {
  const [riga] = await rest(`rubrica?id=eq.${id}&utente_id=eq.${UTENTE}&select=*`) as Riga[]
  if (!riga) throw new Error('Contatto sconosciuto')
  if (riga.eliminata_il) return { gia: true }
  if (riga.risorsa) {
    const p = await google(token, `${riga.risorsa}?personFields=${CAMPI}`)
    await google(token, `${riga.risorsa}:deleteContact`, { method: 'DELETE' })
    await patch(`rubrica?id=eq.${id}`, { eliminata_il: new Date().toISOString(), copia: p ? daGoogle(p) : riga })
  } else await patch(`rubrica?id=eq.${id}`, { eliminata_il: new Date().toISOString() })
  return { ok: true }
}

async function ripristina(token: string, id: string) {
  const [riga] = await rest(`rubrica?id=eq.${id}&utente_id=eq.${UTENTE}&select=*`) as Riga[]
  if (!riga?.eliminata_il) throw new Error('Questo contatto non è eliminato')
  const p = await google(token, `people:createContact?personFields=${CAMPI}`, { method: 'POST', body: JSON.stringify(versoGoogle(riga.copia || riga)) })
  await patch(`rubrica?id=eq.${id}`, { ...daGoogle(p), eliminata_il: null })
  return { ok: true }
}

// --- Pulizia (13.10.2026, richiesta di Giovanni) ---
// 1. Contatti doppi: stesso numero (spazi a parte) E stesso nome di battesimo → uno solo, con tutti i numeri e le mail.
//    Numero uguale ma nome diverso (es. "Mamma (Leo)" e "Teresa Mamma Elodie", il centralino di una ditta) → restano separati.
// 2. Nello stesso contatto, lo stesso numero scritto due volte (con e senza spazi) → uno solo.
// 3. Numero di telefono scritto nel nome → tolto dal nome e messo tra i numeri.
// Lavora sul contatto vero di Google (batchGet): il resto (foto, indirizzi, secondo nome…) non si tocca.
// { azione: 'pulisci', prova: true } dice solo cosa farebbe.
const chiaveNumero = (t: string) => {
  const d = String(t || '').replace(/\D/g, '')
  return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '41' + d.slice(1) : d
}
const SPAZI = /[‪-‮ ]/g
const NUMERO_NEL_NOME = /\+?\d[\d\s/.-]{6,}\d/g
const primaParola = (r: Riga) => String([r.nome, r.cognome].filter(Boolean).join(' ')).normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z]+/)?.[0] || ''

// Toglie i numeri dal nome: restituisce i nomi puliti e i numeri trovati (o null se non c'era niente).
function nomeSenzaNumeri(n: any) {
  const given = String(n?.givenName || '').replace(SPAZI, ' ')
  const family = String(n?.familyName || '').replace(SPAZI, ' ')
  const tutto = `${given} ${family}`.trim()
  // Il nome è solo un numero (anche spezzato tra nome e cognome: "+41 78 905 | 88").
  if (/^[+\d\s/.-]+$/.test(tutto) && tutto.replace(/\D/g, '').length >= 8) return { given: '', family: '', numeri: [tutto.replace(/\s+/g, ' ')] }
  const numeri: string[] = []
  const pulisci = (s: string) => s.replace(NUMERO_NEL_NOME, (m) => {
    if (m.replace(/\D/g, '').length < 8) return m
    numeri.push(m.trim()); return ' '
  }).replace(/\s+/g, ' ').replace(/^[\s|,;-]+|[\s|,;-]+$/g, '').trim()
  const g = pulisci(given), f = pulisci(family)
  return numeri.length ? { given: g, family: f, numeri } : null
}

// Numeri senza doppioni: tra due uguali tiene quello scritto con gli spazi (più leggibile).
function numeriUnici(lista: any[]) {
  const per = new Map<string, any>()
  for (const t of lista) {
    const k = chiaveNumero(t.canonicalForm || t.value)
    if (!k) continue
    const prima = per.get(k)
    if (!prima) per.set(k, t)
    else if (!/\s/.test(prima.value) && /\s/.test(t.value)) per.set(k, { ...t, type: prima.type || t.type })
  }
  // Un numero tagliato (es. dal nome "+41 78 905 | 88") dentro un altro numero intero dello stesso contatto: resta l'intero.
  const chiavi = [...per.keys()]
  for (const k of chiavi) if (chiavi.some((x) => x !== k && x.length > k.length && dentro(k, x))) per.delete(k)
  return [...per.values()].map(({ value, type }) => ({ value, ...(type ? { type } : {}) }))
}
// Le cifre di a compaiono in ordine dentro b?
function dentro(a: string, b: string) {
  let i = 0
  for (const c of b) if (c === a[i]) i++
  return i === a.length
}
const numeriDaSistemare = (lista: Riga[]) => {
  const k = lista.map((t) => chiaveNumero(t.e164 || t.valore)).filter(Boolean)
  return new Set(k).size < k.length || k.some((a) => k.some((b) => b !== a && b.length > a.length && dentro(a, b)))
}

// coppie = unioni scelte da Giovanni ([resta, via], es. "Mamma (Leo)" dentro "Teresa Mamma Elodie"): si fanno solo quelle.
async function pulisci(token: string, prova: boolean, coppie?: [string, string][]) {
  const righe = await tutte(`rubrica?utente_id=eq.${UTENTE}&eliminata_il=is.null&risorsa=not.is.null&select=*`) as Riga[]
  if (coppie?.length) {
    const per = new Map(righe.map((r) => [r.id, r]))
    const scelte = coppie.map(([a, b]) => ({ resta: per.get(a)!, via: [per.get(b)!] })).filter((u) => u.resta && u.via[0] && u.resta.id !== u.via[0].id)
    return unisci(token, prova, scelte, scelte.map((u) => u.resta))
  }
  // 1. Gruppi da unire (unione-ricerca su numero + nome di battesimo).
  const padre = righe.map((_, i) => i)
  const radice = (i: number): number => (padre[i] === i ? i : (padre[i] = radice(padre[i])))
  const primo = new Map<string, number>()
  righe.forEach((r, i) => {
    const p = primaParola(r)
    if (!p) return
    for (const t of r.telefoni as Riga[]) {
      const k = chiaveNumero(t.e164 || t.valore)
      if (k.length < 8) continue
      const chiave = `${k}|${p}`
      if (primo.has(chiave)) padre[radice(i)] = radice(primo.get(chiave)!)
      else primo.set(chiave, i)
    }
  })
  const gruppi = new Map<number, Riga[]>()
  righe.forEach((r, i) => { const g = radice(i); gruppi.set(g, [...(gruppi.get(g) || []), r]) })
  const unioni = [...gruppi.values()].filter((g) => g.length > 1).map((g) => {
    const ord = [...g].sort((a, b) => Number(!!b.persona_id) - Number(!!a.persona_id)
      || [b.nome, b.cognome].join(' ').length - [a.nome, a.cognome].join(' ').length
      || (b.telefoni.length + b.email.length) - (a.telefoni.length + a.email.length))
    return { resta: ord[0], via: ord.slice(1) }
  })
  const viaIds = new Set(unioni.flatMap((u) => u.via.map((r) => r.id)))

  // 2-3. Contatti da sistemare (quelli che restano).
  const daSistemare = righe.filter((r) => !viaIds.has(r.id) && (
    unioni.some((u) => u.resta.id === r.id)
    || numeriDaSistemare(r.telefoni as Riga[])
    || nomeSenzaNumeri({ givenName: r.nome, familyName: r.cognome })))

  return unisci(token, prova, unioni, daSistemare)
}

async function unisci(token: string, prova: boolean, unioni: { resta: Riga, via: Riga[] }[], daSistemare: Riga[]) {
  const viaIds = new Set(unioni.flatMap((u) => u.via.map((r) => r.id)))
  if (prova) {
    return {
      unioni: unioni.length, contatti_tolti: viaIds.size, da_sistemare: daSistemare.length,
      esempi_unioni: unioni.slice(0, 200).map((u) => `${nomeContatto(u.resta)}  ⟵  ${u.via.map(nomeContatto).join(' + ')}`),
      nomi: daSistemare.map((r) => ({ r, n: nomeSenzaNumeri({ givenName: r.nome, familyName: r.cognome }) })).filter((x) => x.n)
        .map((x) => `${nomeContatto(x.r)}  →  «${[x.n!.given, x.n!.family].filter(Boolean).join(' ')}» + ${x.n!.numeri.join(', ')}`),
    }
  }

  // Contatti veri da Google (200 alla volta).
  const servono = [...daSistemare, ...unioni.flatMap((u) => u.via)].map((r) => r.risorsa)
  const veri = new Map<string, any>()
  for (let i = 0; i < servono.length; i += 200) {
    const q = new URLSearchParams({ personFields: CAMPI })
    for (const x of servono.slice(i, i + 200)) q.append('resourceNames', x)
    const r = await google(token, `people:batchGet?${q}`)
    for (const x of r?.responses || []) if (x.person) veri.set(x.person.resourceName, x.person)
  }

  const aggiornati: Record<string, any> = {}
  for (const r of daSistemare) {
    const p = veri.get(r.risorsa)
    if (!p) continue
    const u = unioni.find((x) => x.resta.id === r.id)
    const altri = (u?.via || []).map((x) => veri.get(x.risorsa)).filter(Boolean)
    let telefoni = [...(p.phoneNumbers || []), ...altri.flatMap((a: any) => a.phoneNumbers || [])]
    const mail = new Map<string, any>()
    for (const e of [...(p.emailAddresses || []), ...altri.flatMap((a: any) => a.emailAddresses || [])]) {
      const k = String(e.value || '').toLowerCase()
      if (k && !mail.has(k)) mail.set(k, { value: e.value, ...(e.type ? { type: e.type } : {}) })
    }
    const nomi = [...(p.names?.length ? p.names : [{}])]
    const n = nomeSenzaNumeri(nomi[0])
    if (n) {
      nomi[0] = { ...nomi[0], givenName: n.given, familyName: n.family }
      delete nomi[0].displayName; delete nomi[0].unstructuredName; delete nomi[0].displayNameLastFirst
      telefoni = [...telefoni, ...n.numeri.map((v) => ({ value: v, type: 'mobile' }))]
    }
    const tieni = (x: any[]) => x.map(({ metadata: _m, ...resto }) => resto)
    aggiornati[r.risorsa] = {
      etag: p.etag,
      names: tieni(nomi).filter((x) => x.givenName || x.familyName).slice(0, 1),
      phoneNumbers: numeriUnici(telefoni),
      emailAddresses: [...mail.values()],
      organizations: tieni(p.organizations?.length ? p.organizations : altri.find((a: any) => a.organizations?.length)?.organizations || []),
      biographies: tieni(p.biographies?.length ? p.biographies : altri.find((a: any) => a.biographies?.length)?.biographies || []),
      birthdays: tieni(p.birthdays?.length ? p.birthdays : altri.find((a: any) => a.birthdays?.length)?.birthdays || []),
    }
  }

  let corretti = 0
  const voci = Object.entries(aggiornati)
  for (let i = 0; i < voci.length; i += 200) {
    const r = await google(token, 'people:batchUpdateContacts', { method: 'POST', body: JSON.stringify({
      contacts: Object.fromEntries(voci.slice(i, i + 200)),
      updateMask: 'names,phoneNumbers,emailAddresses,organizations,biographies,birthdays', readMask: CAMPI }) })
    const fatti = Object.values(r?.updateResult || {}).map((x: any) => x.person).filter(Boolean)
    for (const p of fatti) await patch(`rubrica?risorsa=eq.${encodeURIComponent(p.resourceName)}`, daGoogle(p))
    corretti += fatti.length
  }

  // I doppioni: la scheda passa a chi resta, poi via da Google (qui resta la copia per "Ripristina").
  // Tutti in una richiesta sola: Google conta poche eliminazioni al minuto.
  const pronte = unioni.filter((u) => aggiornati[u.resta.risorsa]) // chi resta non si è aggiornato: non si toglie niente
  const daTogliere = pronte.flatMap((u) => u.via.map((x) => x.risorsa))
  for (let i = 0; i < daTogliere.length; i += 500) {
    await google(token, 'people:batchDeleteContacts', { method: 'POST', body: JSON.stringify({ resourceNames: daTogliere.slice(i, i + 500) }) })
  }
  for (const u of pronte) {
    const scheda = u.resta.persona_id || u.via.find((x) => x.persona_id)?.persona_id || null
    if (scheda && !u.resta.persona_id) await patch(`rubrica?id=eq.${u.resta.id}`, { persona_id: scheda })
    for (const x of u.via) {
      await patch(`rubrica?id=eq.${x.id}`, { eliminata_il: new Date().toISOString(), copia: veri.get(x.risorsa) ? daGoogle(veri.get(x.risorsa)) : x,
        appunti: `Unito in «${nomeContatto(u.resta)}» il ${new Date().toLocaleDateString('it-CH')}` })
    }
  }
  return { corretti, uniti: pronte.length, tolti: daTogliere.length }
}
const nomeContatto = (r: Riga) => [r.nome, r.cognome].filter(Boolean).join(' | ') || r.ditta || 'Senza nome'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)
  const corpo = await req.json().catch(() => ({}))
  const { azione, id, campi, persona_id, area } = corpo

  // Il giro programmato (solo sincronizza) oppure Giovanni dall'app.
  const programmato = !!COPIA_TOKEN && req.headers.get('x-copia-token') === COPIA_TOKEN
  if (!programmato) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } })
    const utente = u.ok ? await u.json() : null
    if (utente?.id !== UTENTE || daConnettore(jwt)) return risposta({ errore: 'Non autorizzato' }, 401)
  } else if (azione !== 'sincronizza' && azione !== 'pulisci') return risposta({ errore: 'Non autorizzato' }, 401)

  const uuid = (x: unknown) => /^[0-9a-f-]{36}$/.test(String(x))
  try {
    if (azione === 'sincronizza') {
      if (programmato && !Deno.env.get('CONTATTI_REFRESH_TOKEN')) return risposta({ ok: false, motivo: 'non collegata' })
      return risposta(await sincronizza())
    }
    const token = await accesso()
    if (azione === 'pulisci') {
      const coppie = Array.isArray(corpo.coppie) ? corpo.coppie.filter((c: unknown) => Array.isArray(c) && c.length === 2 && c.every(uuid)) : undefined
      return risposta(await pulisci(token, corpo.prova !== false, coppie))
    }
    if (azione === 'salva' && persona_id) {
      if (!uuid(persona_id)) return risposta({ errore: 'Persona sconosciuta' }, 400)
      return risposta(await salvaPersona(token, persona_id))
    }
    if (azione === 'salva') {
      if (id && !uuid(id)) return risposta({ errore: 'Contatto sconosciuto' }, 400)
      return risposta(await salva(token, id || null, campi || {}, area || null))
    }
    if (!uuid(id)) return risposta({ errore: 'Contatto sconosciuto' }, 400)
    if (azione === 'elimina') return risposta(await elimina(token, id))
    if (azione === 'ripristina') return risposta(await ripristina(token, id))
    return risposta({ errore: 'Azione sconosciuta' }, 400)
  } catch (e) {
    return risposta({ errore: String((e as Error)?.message || e).slice(0, 300) }, 502)
  }
})
