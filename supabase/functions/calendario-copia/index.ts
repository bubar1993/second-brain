// Copia da Google Calendar (28.10.2026, ok di Giovanni, tappa 1). La chiama pg_cron ogni 10 minuti; lavora solo
// dalle 6 alle 23 di Zurigo. Al posto della copia che faceva l'agente calendario col connettore di claude.ai, che dal
// 26.10 risponde "quota esaurita".
// Legge il calendario giovannifabris@ceramex.ch con il client di Giovanni (permesso calendar.readonly, segreto
// CALENDARIO_REFRESH_TOKEN, quota del suo progetto Google) e lo copia in eventi con calendario_copia() (SQL).
// In Google non scrive mai: solo GET. Finestra come l'agente: da 2 giorni fa (00:00 di Zurigo) a 45 giorni avanti.
// Gli eventi del database che Google non dà più nella finestra li rilegge uno per uno: cancellati → 'cancellato',
// spostati fuori finestra → data nuova.
// Registro (lavori_registro 'calendario-copia'): quando cambia qualcosa, quando sbaglia e almeno una volta all'ora.
// Con { "prova": true } dice cosa cambierebbe, senza scrivere niente (anche di notte).
// Risponde sempre 200: l'errore va nel registro.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const CALENDARIO_REFRESH = Deno.env.get('CALENDARIO_REFRESH_TOKEN')
const CALENDARIO = 'giovannifabris@ceramex.ch'
const CAMPI = 'id,status,summary,description,location,start,end,attendees(email,self,resource,responseStatus),organizer(email,self),colorId,eventType,recurringEventId,updated,created'
const MAX_PAGINE = 10

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

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

async function accesso() {
  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GMAIL_CLIENT_ID')!, client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: CALENDARIO_REFRESH!, grant_type: 'refresh_token',
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
async function leggiUno(h: HeadersInit, id: string) {
  const r = await fetch(`${base}/${encodeURIComponent(id)}?fields=${encodeURIComponent(CAMPI)}`, { headers: h })
  if (r.status === 404 || r.status === 410) { await r.body?.cancel(); return { id, status: 'cancelled' } }
  if (!r.ok) throw new Error(`Google Calendar ${r.status} per un evento`)
  return await r.json()
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

  // letto: le righe toccate dopo (l'agente ha appena spostato o creato) la copia le salta fino al giro dopo.
  const o: Opzioni = { dal: mezzanotte(adesso) - 2 * 86400000, al: adesso + 45 * 86400000, letto: adesso, prova: !!prova, sblocca: !!sblocca }
  try {
    const h = await accesso()
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
    // Solo numeri: il registro lo legge anche lo smistatore (lavoro), i titoli possono essere privati.
    const dettagli = {
      letti: uno.letti, esclusi: uno.esclusi, adottati: somma('adottati'), nuovi: somma('nuovi'), aggiornati: somma('aggiornati'),
      cancellati: somma('cancellati'), riletti: mancanti.length, freno: !!(uno.freno || due?.freno),
    }
    if (prova) return Response.json({ ok: true, prova: true, ...dettagli, uno, due })

    const cambiato = dettagli.adottati + dettagli.nuovi + dettagli.aggiornati + dettagli.cancellati > 0
    const [ultimo] = await rest('lavori_registro?lavoro=eq.calendario-copia&order=iniziata_il.desc&limit=1&select=iniziata_il,ok') || []
    const vecchio = !ultimo || !ultimo.ok || adesso - Date.parse(ultimo.iniziata_il) > 55 * 60000
    if (dettagli.freno) await registra(false, dettagli, 'Più di 10 eventi cancellati in Google in una volta: non li ho segnati, controllare a mano.')
    else if (cambiato || vecchio) await registra(true, dettagli)
    return Response.json({ ok: true, ...dettagli })
  } catch (e) {
    const errore = String((e as Error)?.message || e).slice(0, 300)
    if (!prova) await registra(false, {}, errore).catch(() => {})
    return Response.json({ ok: false, errore })
  }
})
