// Google Calendar del second brain (28.10.2026, ok di Giovanni). La chiama pg_cron ogni 10 minuti; lavora solo dalle
// 6 alle 23 di Zurigo. Al posto dell'agente calendario col connettore di claude.ai, che dal 26.10 risponde "quota
// esaurita". Tutto col client di Giovanni (quota del suo progetto Google), calendario fisso giovannifabris@ceramex.ch.
// 1. SCRITTURE (tappa 2, segreto CALENDARIO_SCRIVI_TOKEN col permesso calendar.events, accese solo con
//    CALENDARIO_SCRITTURE = 'si'): sposta gli appuntamenti cambiati nell'app (eventi.cambio), crea i 'da_creare',
//    mette il colore dell'area. Solo quelli messi dall'app, dai trigger del database o dall'agente calendario
//    (cambio_da / da_creare_da): gli altri tornano proposte. Mai cancellare, mai invitati, sempre sendUpdates=none.
//    Gli eventi creati hanno come id quello della riga (senza trattini): se il giro cade a metà, il giro dopo non
//    crea un doppione (Google risponde 409 e la riga prende l'evento che c'è). Al massimo 40 scritture per giro e
//    400 al giorno (poi si ferma fino a domani, registro ok = false).
// 2. COPIA (tappa 1, segreto CALENDARIO_REFRESH_TOKEN, calendar.readonly): legge tutta la finestra (da 2 giorni fa
//    alle 00:00 di Zurigo a 45 giorni avanti) e la copia in eventi con calendario_copia() (SQL). Gli eventi del
//    database che Google non dà più nella finestra li rilegge uno per uno: cancellati → 'cancellato', spostati
//    fuori finestra → data nuova.
// Registro (lavori_registro 'calendario-copia', solo numeri e id di Google: lo legge anche lo smistatore): quando
// cambia o scrive qualcosa, quando sbaglia e almeno una volta all'ora.
// Con { "prova": true } dice cosa farebbe, senza scrivere niente né in Google né nel database (anche di notte).
// Risponde sempre 200: l'errore va nel registro.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const CALENDARIO_REFRESH = Deno.env.get('CALENDARIO_REFRESH_TOKEN')
const CALENDARIO_SCRIVI = Deno.env.get('CALENDARIO_SCRIVI_TOKEN')
const SCRITTURE = Deno.env.get('CALENDARIO_SCRITTURE') === 'si'
const CALENDARIO = 'giovannifabris@ceramex.ch'
const CAMPI = 'id,status,summary,description,location,start,end,attendees(email,self,resource,responseStatus),organizer(email,self),colorId,eventType,recurringEventId,updated,created'
const MAX_PAGINE = 10
const MAX_SCRITTURE = 40
const MAX_SCRITTURE_GIORNO = 400
// Colore dell'area (un calendario solo): C mirtillo, G basilico, P mandarino.
const COLORI: Record<string, string> = { C: '9', G: '10', P: '6' }
// Chi può far scrivere in Google: l'app di Giovanni, i trigger del database (eventi messi da soli dalle sue note),
// l'agente calendario (richieste di Giovanni).
const AMMESSI = ['authenticated', 'postgres', 'agente_calendario']

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}
// Aggiorna una riga; con "cambioIl" solo se nel frattempo Giovanni non ha cambiato di nuovo l'appuntamento.
const aggiornaRiga = (id: string, campi: Record<string, unknown>, cambioIl?: string) =>
  rest(`eventi?id=eq.${id}${cambioIl ? `&cambio_il=eq.${encodeURIComponent(cambioIl)}` : ''}`,
    { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })

const formato = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', year: 'numeric', day: '2-digit', month: '2-digit', hourCycle: 'h23',
})
const zurigo = (ms: number) => {
  const p = Object.fromEntries(formato.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { ora: Number(p.hour), minuti: Number(p.minute), giorno: `${p.year}-${p.month}-${p.day}` }
}
// Mezzanotte di Zurigo del giorno di "ms" (con l'ora legale giusta).
function mezzanotte(ms: number) {
  const z = zurigo(ms)
  return ms - (z.ora * 60 + z.minuti) * 60000 - (ms % 60000)
}
const giornoDopo = (g: string) => new Date(Date.parse(`${g}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)

// Inizio e fine per Google. Tutto il giorno: le date di Zurigo, la fine esclusa come in Google. Con l'orario: fine
// o un'ora. "patch": i campi dell'altro tipo a null, così un evento può passare da orario a tutto il giorno e indietro.
function tempi(inizio: string, fine: string | null, tutto: boolean, patch: boolean) {
  const i = Date.parse(inizio)
  if (tutto) {
    const g1 = zurigo(i).giorno
    // +12 ore: la fine fatta di "mezzanotte + ore" (app) resta sul giorno giusto anche col cambio dell'ora.
    let g2 = fine ? zurigo(Date.parse(fine) + 12 * 3600000).giorno : ''
    if (!g2 || g2 <= g1) g2 = giornoDopo(g1)
    const x = patch ? { dateTime: null, timeZone: null } : {}
    return { start: { date: g1, ...x }, end: { date: g2, ...x } }
  }
  const f = fine && Date.parse(fine) > i ? Date.parse(fine) : i + 3600000
  const x = patch ? { date: null } : {}
  return {
    start: { dateTime: new Date(i).toISOString(), timeZone: 'Europe/Zurich', ...x },
    end: { dateTime: new Date(f).toISOString(), timeZone: 'Europe/Zurich', ...x },
  }
}

async function accesso(refresh: string) {
  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GMAIL_CLIENT_ID')!, client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  })).json()
  if (!tok.access_token) throw new Error(`Google: ${tok.error || 'nessun accesso'}`)
  return { Authorization: `Bearer ${tok.access_token}` }
}
const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDARIO)}/events`

// Tutta la finestra, tutte le pagine. Se manca una pagina, errore: niente copia a metà.
async function leggiFinestra(h: HeadersInit, dal: number, al: number) {
  const eventi: unknown[] = []
  let pagina: string | undefined
  for (let i = 0; i < MAX_PAGINE; i++) {
    const q = new URLSearchParams({
      timeMin: new Date(dal).toISOString(), timeMax: new Date(al).toISOString(), singleEvents: 'true', showDeleted: 'true',
      maxResults: '250', fields: `items(${CAMPI}),nextPageToken`,
    })
    if (pagina) q.set('pageToken', pagina)
    const r = await fetch(`${base}?${q}`, { headers: h })
    if (!r.ok) throw new Error(`Google Calendar ${r.status} ${(await r.text()).slice(0, 200)}`)
    const j = await r.json()
    eventi.push(...(j.items || []))
    pagina = j.nextPageToken
    if (!pagina) return eventi
  }
  throw new Error(`più di ${MAX_PAGINE} pagine di eventi`)
}

// Un evento solo. 404/410 = non c'è più: torna come cancellato.
// deno-lint-ignore no-explicit-any
async function leggiUno(h: HeadersInit, id: string): Promise<any> {
  const r = await fetch(`${base}/${encodeURIComponent(id)}?fields=${encodeURIComponent(CAMPI)}`, { headers: h })
  if (r.status === 404 || r.status === 410) { await r.body?.cancel(); return { id, status: 'cancelled' } }
  if (!r.ok) throw new Error(`Google Calendar ${r.status} per un evento`)
  return await r.json()
}

// Scrittura in Google: solo POST (creare) e PATCH (spostare, colore). Nessun DELETE in questo file.
async function scriviGoogle(h: HeadersInit, metodo: 'POST' | 'PATCH', id: string | null, corpo: Record<string, unknown>) {
  const url = `${base}${id ? `/${encodeURIComponent(id)}` : ''}?sendUpdates=none`
  return await fetch(url, { method: metodo, headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
}

type Fatto = { op: string, id: string, esito: string }
// deno-lint-ignore no-explicit-any
type Riga = Record<string, any>

// Un orario dal database o dall'agente deve avere il fuso (Z o +01:00): senza, Deno lo leggerebbe in UTC (un'ora
// o due di differenza da Zurigo).
const conFuso = (s: unknown) => typeof s === 'string' && /(Z|[+-]\d\d:?\d\d)$/.test(s.trim())
const vero = (v: unknown) => v === true || v === 'true'

// Prima le scritture, poi la copia: così la copia legge Google già aggiornato.
// Ogni riga ha il suo try/catch: una riga difettosa si segna e si va avanti, non ferma le altre.
async function scritture(h: HeadersInit, o: Opzioni, giaOggi: number) {
  const log: Fatto[] = []
  let scritte = 0
  const posso = () => scritte < MAX_SCRITTURE && giaOggi + scritte < MAX_SCRITTURE_GIORNO
  const ora = Date.now()
  // Una riga con un errore si riprova dopo un'ora, non ogni 10 minuti.
  const daFare = (r: Riga) => !r.errore || ora - Date.parse(r.modificata_il) > 60 * 60000
  const segna = async (r: Riga, campi: Record<string, unknown>, cambioIl?: string) => { if (!o.prova) await aggiornaRiga(r.id, campi, cambioIl) }
  const sbaglio = async (op: string, r: Riga, id: string, e: unknown) => {
    const testo = String((e as Error)?.message || e).slice(0, 150)
    log.push({ op, id, esito: `errore ${testo}` })
    await segna(r, { errore: `Non riuscito: ${testo.slice(0, 80)} (riprovo tra un'ora)` }).catch(() => {})
  }

  // 1. Spostamenti chiesti dall'app (stesso evento, mai uno nuovo).
  const cambi: Riga[] = await rest('eventi?cambio=not.is.null&google_id=not.is.null&order=cambio_il&select=id,google_id,cambio,cambio_il,cambio_da,errore,modificata_il') || []
  for (const r of cambi.filter(daFare)) {
    if (!posso()) break
    try {
      const via = { cambio: null, cambio_il: null }
      if (!AMMESSI.includes(r.cambio_da)) {
        await segna(r, { ...via, errore: 'Spostamento non chiesto dall\'app: fallo da Google Calendar' }, r.cambio_il)
        log.push({ op: 'sposta', id: r.google_id, esito: 'non dall\'app' }); continue
      }
      const c = r.cambio
      if (!c?.titolo || !conFuso(c?.inizio) || (c?.fine && !conFuso(c.fine))) {
        await segna(r, { ...via, errore: 'Spostamento senza titolo, senza data o con un orario senza fuso' }, r.cambio_il)
        log.push({ op: 'sposta', id: r.google_id, esito: 'dati sbagliati' }); continue
      }
      const ev = await leggiUno(h, r.google_id)
      if (ev.status === 'cancelled') {
        await segna(r, { ...via, errore: 'Non più in Google Calendar' }, r.cambio_il)
        log.push({ op: 'sposta', id: r.google_id, esito: 'non c\'è più' }); continue
      }
      // deno-lint-ignore no-explicit-any
      if ((ev.attendees || []).some((a: any) => !a.self && !a.resource) || ev.organizer?.self === false) {
        await segna(r, { ...via, errore: 'Ha degli invitati: spostalo da Google Calendar' }, r.cambio_il)
        log.push({ op: 'sposta', id: r.google_id, esito: 'invitati' }); continue
      }
      if (o.prova) { log.push({ op: 'sposta', id: r.google_id, esito: 'lo farei' }); continue }
      scritte++
      const p = await scriviGoogle(h, 'PATCH', r.google_id,
        { summary: c.titolo, location: c.luogo || '', ...tempi(c.inizio, c.fine, vero(c.tutto_il_giorno), true) })
      await p.body?.cancel()
      if (!p.ok) throw new Error(`Google ${p.status}`)
      await aggiornaRiga(r.id, { titolo: c.titolo, inizio: c.inizio, fine: c.fine || null, luogo: c.luogo || null,
        tutto_il_giorno: vero(c.tutto_il_giorno), ...via, errore: null }, r.cambio_il)
      log.push({ op: 'sposta', id: r.google_id, esito: 'fatto' })
    } catch (e) { await sbaglio('sposta', r, r.google_id, e) }
  }

  // 2. Appuntamenti approvati da creare.
  const nuovi: Riga[] = await rest('eventi?stato=eq.da_creare&google_id=is.null&order=modificata_il&select=id,titolo,inizio,fine,tutto_il_giorno,luogo,descrizione,motivo,area,da_creare_da,errore,modificata_il') || []
  for (const r of nuovi.filter(daFare)) {
    if (!posso()) break
    const gid = String(r.id).replaceAll('-', '')
    try {
      if (!AMMESSI.includes(r.da_creare_da)) {
        // Non approvato da Giovanni: torna una proposta Sì/No nell'app.
        await segna(r, { stato: 'proposto' })
        log.push({ op: 'crea', id: gid, esito: 'torna proposta' }); continue
      }
      if (!r.inizio || !r.titolo) {
        await segna(r, { errore: 'Manca il titolo o la data' })
        log.push({ op: 'crea', id: gid, esito: 'dati mancanti' }); continue
      }
      // Giovanni l'ha già messo lui in Google (stesso titolo, stessa ora): non si crea un doppione.
      const uguali: Riga[] = await rest(`eventi?stato=eq.confermato&google_id=not.is.null&titolo=eq.${encodeURIComponent(r.titolo)}&inizio=gte.${encodeURIComponent(new Date(Date.parse(r.inizio) - 60000).toISOString())}&inizio=lte.${encodeURIComponent(new Date(Date.parse(r.inizio) + 60000).toISOString())}&select=id`) || []
      if (uguali.length) {
        await segna(r, { stato: 'scartato', errore: 'C\'era già in Google Calendar' })
        log.push({ op: 'crea', id: gid, esito: 'c\'era già' }); continue
      }
      const colore = COLORI[r.area] || null
      // La descrizione intera per prima (per le call: link, ID e codice), poi da dove viene.
      const descrizione = [r.descrizione, `Dal second brain${r.motivo ? `: ${r.motivo}` : ''}`].filter(Boolean).join('\n\n')
      if (o.prova) { log.push({ op: 'crea', id: gid, esito: 'lo farei' }); continue }
      scritte++
      const p = await scriviGoogle(h, 'POST', null, { id: gid, summary: r.titolo, description: descrizione,
        ...(r.luogo ? { location: r.luogo } : {}), ...(colore ? { colorId: colore } : {}),
        ...tempi(r.inizio, r.fine, !!r.tutto_il_giorno, false) })
      let ev
      if (p.status === 409) { await p.body?.cancel(); ev = await leggiUno(h, gid) } // c'è già: un giro di prima l'ha creato
      else if (!p.ok) throw new Error(`Google ${p.status} ${(await p.text()).slice(0, 100).replace(/\s+/g, ' ')}`)
      else ev = await p.json()
      // Il google_id è già su un'altra riga (la copia l'ha preso prima): questa è un doppione.
      const altra: Riga[] = await rest(`eventi?google_id=eq.${gid}&id=neq.${r.id}&select=id`) || []
      if (altra.length) {
        await aggiornaRiga(r.id, { stato: 'scartato', errore: 'Doppione: l\'appuntamento è già in calendario' })
        log.push({ op: 'crea', id: gid, esito: 'doppione' }); continue
      }
      if (ev.status === 'cancelled') {
        // Creato da un giro di prima e poi cancellato in Google da Giovanni.
        await aggiornaRiga(r.id, { google_id: gid, stato: 'cancellato', errore: null })
        log.push({ op: 'crea', id: gid, esito: 'già cancellato in Google' }); continue
      }
      await aggiornaRiga(r.id, { google_id: gid, stato: 'confermato', errore: null, colore,
        google: { colore: ev.colorId || colore, tipo: ev.eventType || 'default', mio: true } })
      log.push({ op: 'crea', id: gid, esito: 'fatto' })
    } catch (e) { await sbaglio('crea', r, gid, e) }
  }

  // 3. Colori: vuoto in Google, o messo da noi ma l'area è cambiata. Un colore scelto a mano da Giovanni non si tocca.
  const q = new URLSearchParams({ stato: 'eq.confermato', google_id: 'not.is.null', area: 'not.is.null', google: 'not.is.null',
    cambio: 'is.null', select: 'id,google_id,area,colore,google,colore_errore_il' })
  q.append('inizio', `gte.${new Date(o.dal).toISOString()}`)
  q.append('inizio', `lt.${new Date(o.al).toISOString()}`)
  const righe: Riga[] = await rest(`eventi?${q}`) || []
  for (const r of righe) {
    const g = r.google || {}
    const giusto = COLORI[r.area]
    if (!giusto || g.tipo !== 'default') continue
    if (!(g.colore == null || (g.colore === r.colore && r.colore !== giusto))) continue
    // Un evento che Google non lascia colorare (per es. di un altro calendario) si riprova il giorno dopo.
    if (r.colore_errore_il && ora - Date.parse(r.colore_errore_il) < 86400000) continue
    if (!posso()) break
    if (o.prova) { log.push({ op: 'colore', id: r.google_id, esito: `lo metterei ${giusto}` }); continue }
    try {
      scritte++
      const p = await scriviGoogle(h, 'PATCH', r.google_id, { colorId: giusto })
      await p.body?.cancel()
      if (!p.ok) {
        await aggiornaRiga(r.id, { colore_errore_il: new Date().toISOString() })
        log.push({ op: 'colore', id: r.google_id, esito: `errore ${p.status}` }); continue
      }
      await aggiornaRiga(r.id, { colore: giusto, google: { ...g, colore: giusto }, colore_errore_il: null })
      log.push({ op: 'colore', id: r.google_id, esito: `fatto ${giusto}` })
    } catch (e) {
      log.push({ op: 'colore', id: r.google_id, esito: `errore ${String((e as Error)?.message || e).slice(0, 100)}` })
      await aggiornaRiga(r.id, { colore_errore_il: new Date().toISOString() }).catch(() => {})
    }
  }
  return { log, scritte, freno: !posso() && giaOggi + scritte >= MAX_SCRITTURE_GIORNO }
}

type Opzioni = { dal: number, al: number, letto: number, prova: boolean, sblocca: boolean }
const copia = (eventi: unknown[], finestra: boolean, o: Opzioni) =>
  rest('rpc/calendario_copia', { method: 'POST', body: JSON.stringify({
    p_eventi: eventi, p_dal: new Date(o.dal).toISOString(), p_al: new Date(o.al).toISOString(),
    p_letto_il: new Date(o.letto).toISOString(), p_finestra: finestra, p_prova: o.prova,
    // sblocca: il freno dei cancellati (più di 10 serie in una volta) non vale, per una volta, chiamata a mano.
    ...(o.sblocca ? { p_max_serie: 1000 } : {}),
  }) })

async function registra(ok: boolean, dettagli: Record<string, unknown>, errore?: string) {
  await rest('lavori_registro', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ lavoro: 'calendario-copia', ok, dettagli, errore: errore || null }) })
}

Deno.serve(async (req) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) return new Response('Non autorizzato', { status: 401 })
  const { prova, sblocca } = await req.json().catch(() => ({}))
  const adesso = Date.now()
  const z = zurigo(adesso)
  if (!prova && (z.ora < 6 || z.ora >= 23)) return Response.json({ ok: true, fatto: 'notte' })
  if (!CALENDARIO_REFRESH) return Response.json({ ok: false, errore: 'manca il segreto CALENDARIO_REFRESH_TOKEN' })

  const o: Opzioni = { dal: mezzanotte(adesso) - 2 * 86400000, al: adesso + 45 * 86400000, letto: adesso, prova: !!prova, sblocca: !!sblocca }
  const errori: string[] = []
  // deno-lint-ignore no-explicit-any
  let s: any = null
  // Le scritture: accese con CALENDARIO_SCRITTURE = 'si'; la prova le mostra appena c'è il permesso.
  // Accese ma senza permesso: errore (il guardiano avvisa), perché nessun altro scrive più in Google.
  if (SCRITTURE && !CALENDARIO_SCRIVI) errori.push('Scritture accese ma manca il segreto CALENDARIO_SCRIVI_TOKEN: in Google non arriva niente.')
  if (CALENDARIO_SCRIVI && (SCRITTURE || prova)) {
    try {
      const oggi: { dettagli: { scritte?: number } | null }[] = await rest(`lavori_registro?lavoro=eq.calendario-copia&iniziata_il=gte.${encodeURIComponent(new Date(mezzanotte(adesso)).toISOString())}&select=dettagli`) || []
      const giaOggi = oggi.reduce((n, r) => n + Number(r.dettagli?.scritte || 0), 0)
      s = await scritture(await accesso(CALENDARIO_SCRIVI), o, giaOggi)
      if (s.freno) errori.push(`Più di ${MAX_SCRITTURE_GIORNO} scritture in Google oggi: mi fermo fino a domani, controllare a mano.`)
    } catch (e) {
      errori.push(`Scritture: ${String((e as Error)?.message || e).slice(0, 250)}`)
    }
  }
  // letto dopo le scritture: le righe toccate dopo (l'agente ha appena cambiato qualcosa) la copia le salta fino al giro dopo.
  o.letto = Date.now()
  try {
    const h = await accesso(CALENDARIO_REFRESH)
    const eventi = await leggiFinestra(h, o.dal, o.al)
    // Troppi mancanti (più di 150): calendario_copia dà errore prima di scrivere.
    const uno = await copia(eventi, true, o)
    const mancanti: string[] = uno.mancanti || []
    // I mancanti si rileggono uno per uno (pochi: eventi cancellati o spostati fuori finestra).
    let due: Record<string, unknown> | null = null
    if (mancanti.length) {
      const riletti = []
      for (const id of mancanti) riletti.push(await leggiUno(h, id))
      due = await copia(riletti, false, o)
    }
    const somma = (k: string) => Number(uno[k] || 0) + Number(due?.[k] || 0)
    // Solo numeri e id di Google: il registro lo legge anche lo smistatore (lavoro), i titoli possono essere privati.
    const dettagli = {
      letti: uno.letti, esclusi: uno.esclusi, adottati: somma('adottati'), nuovi: somma('nuovi'), aggiornati: somma('aggiornati'),
      cancellati: somma('cancellati'), riletti: mancanti.length, freno: !!(uno.freno || due?.freno),
      scritte: s?.scritte || 0, scritture: s?.log || [],
    }
    if (prova) return Response.json({ ok: true, prova: true, ...dettagli, errori, uno, due })

    if (dettagli.freno) errori.push('Più di 10 eventi cancellati in Google in una volta: non li ho segnati, controllare a mano.')
    const cambiato = dettagli.adottati + dettagli.nuovi + dettagli.aggiornati + dettagli.cancellati + dettagli.scritture.length > 0
    const [ultimo] = await rest('lavori_registro?lavoro=eq.calendario-copia&order=iniziata_il.desc&limit=1&select=iniziata_il,ok,errore') || []
    const vecchio = !ultimo || !ultimo.ok || adesso - Date.parse(ultimo.iniziata_il) > 55 * 60000
    if (errori.length) {
      // Lo stesso errore di fila (es. il freno di tutto il giorno) si scrive una volta all'ora, non ogni 10 minuti.
      const uguale = ultimo && !ultimo.ok && ultimo.errore === errori.join(' ') && adesso - Date.parse(ultimo.iniziata_il) < 55 * 60000
      if (!uguale || cambiato) await registra(false, dettagli, errori.join(' '))
    } else if (cambiato || vecchio) await registra(true, dettagli)
    return Response.json({ ok: !errori.length, ...dettagli, errori })
  } catch (e) {
    errori.push(String((e as Error)?.message || e).slice(0, 300))
    if (!prova) await registra(false, { scritte: s?.scritte || 0, scritture: s?.log || [] }, errori.join(' ')).catch(() => {})
    return Response.json({ ok: false, errori, scritture: s?.log || [] })
  }
})
