// Legge la casella info@homeconcepts.ch (IMAP Hostpoint) e salva le mail nel second brain (fase 5).
// La chiama pg_cron ogni 5 minuti. Apre le cartelle in SOLA LETTURA: non segna niente come letto,
// non sposta e non cancella. Poi allinea le conversazioni e annulla le bozze superate
// (qualcuno ha già risposto o è arrivata una mail nuova nella stessa conversazione).
// Legge tutte le cartelle (anche l'archivio per cliente/cantiere), tranne cestino, spam e bozze:
// il percorso della cartella si salva in posta.cartella_imap e aiuta l'agente a trovare cliente e cantiere.
// Storico: a ogni giro legge anche pezzi di mail vecchie (scendendo), finché arriva all'inizio.
// Per stare nei limiti della funzione (poco calcolo) si scarica solo il testo della mail:
// gli allegati restano nella casella, qui si salvano solo nome, tipo e peso.
import { ImapFlow } from 'npm:imapflow@1.0.171'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const IO = 'info@homeconcepts.ch'
const ESCLUSE = /^(Trash|spam|Junk|Drafts)(\/|$)/i
const PEZZO_NUOVE = 60     // mail nuove per cartella e per giro
const PEZZO_STORICO = 20   // mail vecchie per pezzo
type Stato = { cartella: string, uidvalidity: number, ultimo_uid: number, storico_uid: number | null }
const LIMITE_MS = 60000    // poi si ferma e riprende al giro dopo (la funzione ha poco calcolo)

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}
const rpc = (fn: string) => rest(`rpc/${fn}`, { method: 'POST', body: '{}' })

const pulisciId = (s?: string | null) => (s || '').trim().replace(/^<|>$/g, '')
const listaId = (s?: string | null) => ((s || '').match(/<[^>]+>/g) || []).map(pulisciId).filter(Boolean)
const indirizzo = (a?: { address?: string }) => (a?.address || '').toLowerCase()
const indirizzi = (l?: { address?: string }[]) => (l || []).map(indirizzo).filter(Boolean)

// HTML → testo leggibile.
const daHtml = (html: string) => html
  .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')

// Dalla struttura della mail: quale parte è il testo, quale l'invito (text/calendar) e quali sono gli allegati.
type Nodo = { part?: string, type?: string, size?: number, disposition?: string, parameters?: Record<string, string>,
  dispositionParameters?: Record<string, string>, childNodes?: Nodo[] }
function parti(n: Nodo | undefined, out = { testo: '', html: '', calendario: '', allegati: [] as { nome?: string, tipo?: string, kb: number }[] }) {
  if (!n) return out
  if (n.childNodes?.length) { n.childNodes.forEach((c) => parti(c, out)); return out }
  const nome = n.dispositionParameters?.filename || n.parameters?.name
  if (!out.calendario && (n.type === 'text/calendar' || n.type === 'application/ics' || /\.ics$/i.test(nome || ''))) out.calendario = n.part || '1'
  if (nome || n.disposition === 'attachment') out.allegati.push({ nome, tipo: n.type, kb: Math.round((n.size || 0) / 1024) })
  else if (n.type === 'text/plain' && !out.testo) out.testo = n.part || '1'
  else if (n.type === 'text/html' && !out.html) out.html = n.part || '1'
  return out
}

async function scarica(client: ImapFlow, uid: number, parte: string) {
  const { content } = await client.download(String(uid), parte, { uid: true, maxBytes: 60000 })
  const pezzi: Uint8Array[] = []
  for await (const p of content) pezzi.push(typeof p === 'string' ? new TextEncoder().encode(p) : p)
  return new TextDecoder().decode(await new Blob(pezzi).arrayBuffer())
}

// Inviti a call/riunioni (14.10.2026): dalla parte calendario si tengono data, ora, titolo e link per entrare.
// I nomi di fuso di Outlook ("W. Europe Standard Time") si traducono in quelli veri.
const FUSI_WINDOWS: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Zurich', 'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris', 'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London', 'E. Europe Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Athens', 'UTC': 'UTC',
}
const LINK_CALL = /https:\/\/(?:teams\.microsoft\.com\/(?:meet|l\/meetup-join)\/[^\s<>"']+|[\w.-]*zoom\.us\/j\/[^\s<>"']+|meet\.google\.com\/[a-z-]+|[\w.-]*webex\.com\/[^\s<>"']+)/i

// Ora locale di un fuso → ISO in UTC (due passaggi per i cambi d'ora).
function daFuso(y: number, mo: number, d: number, h: number, mi: number, s: number, fuso: string) {
  const voluto = Date.UTC(y, mo - 1, d, h, mi, s)
  const scarto = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t))
    const v = (k: string) => Number(p.find((x) => x.type === k)?.value)
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - t
  }
  let t = voluto - scarto(voluto)
  t = voluto - scarto(t)
  return new Date(t).toISOString()
}

// "DTSTART;TZID=W. Europe Standard Time:20261020T100000" → { quando (ISO), giorno (solo data), fuso }
function dataIcs(riga: string | undefined) {
  if (!riga) return null
  const [testa, valore = ''] = [riga.slice(0, riga.indexOf(':')), riga.slice(riga.indexOf(':') + 1).trim()]
  const m = valore.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (h === undefined) return { giorno: `${y}-${mo}-${d}`, quando: null, fuso: null }
  const tzid = (testa.match(/TZID=("?)([^;:"]+)\1/) || [])[2]
  let fuso = z ? 'UTC' : (tzid ? (FUSI_WINDOWS[tzid] || tzid) : 'Europe/Zurich')
  try { new Intl.DateTimeFormat('en-US', { timeZone: fuso }) } catch { fuso = 'Europe/Zurich' }
  return { giorno: null, quando: daFuso(+y, +mo, +d, +h, +mi, +(s || 0), fuso), fuso: tzid || (z ? 'UTC' : null) }
}

function leggiInvito(ics: string, testoMail: string) {
  const righe = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const inizioEv = righe.findIndex((r) => r.startsWith('BEGIN:VEVENT'))
  if (inizioEv < 0) return null
  const fineEv = righe.findIndex((r, i) => i > inizioEv && r.startsWith('END:VEVENT'))
  const ev = righe.slice(inizioEv, fineEv < 0 ? undefined : fineEv)
  const campo = (nome: string) => ev.find((r) => r.startsWith(nome + ':') || r.startsWith(nome + ';'))
  const valore = (nome: string) => {
    const r = campo(nome)
    return r ? r.slice(r.indexOf(':') + 1).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim() : null
  }
  const metodo = (righe.find((r) => r.startsWith('METHOD:')) || '').slice(7).trim() || null
  const inizio = dataIcs(campo('DTSTART'))
  if (!inizio) return null
  const fine = dataIcs(campo('DTEND'))
  const org = campo('ORGANIZER')
  // Tra i link trovati il più corto: per Teams è quello "teams.microsoft.com/meet/…" col codice già dentro.
  const link = [valore('X-MICROSOFT-SKYPETEAMSMEETINGURL'), valore('URL'), valore('LOCATION'), valore('DESCRIPTION'), testoMail]
    .map((t) => (t || '').match(LINK_CALL)?.[0]).filter(Boolean).sort((a, b) => a!.length - b!.length)[0] || null
  return {
    metodo, stato: valore('STATUS'), titolo: valore('SUMMARY'), luogo: valore('LOCATION'), link, uid: valore('UID'),
    inizio: inizio.quando || inizio.giorno, fine: fine ? (fine.quando || fine.giorno) : null,
    tutto_il_giorno: !inizio.quando, fuso: inizio.fuso,
    organizzatore: org ? (org.match(/mailto:([^\s;]+)/i)?.[1] || null)?.toLowerCase() : null,
  }
}

// Legge un blocco di mail: prima busta e struttura (leggere), poi solo la parte di testo di ognuna.
async function leggiBlocco(client: ImapFlow, da: number, a: number, percorso: string, fino: number) {
  const msgs = await client.fetchAll(`${da}:${a}`, { uid: true, envelope: true, bodyStructure: true, headers: ['references'] }, { uid: true })
  const righe = []
  for (const m of msgs) {
    if (Date.now() > fino) break
    try {
      const e = m.envelope || {}
      const p = parti(m.bodyStructure as Nodo)
      let testo = ''
      if (p.testo) testo = await scarica(client, m.uid, p.testo)
      else if (p.html) testo = daHtml(await scarica(client, m.uid, p.html))
      // Un invito illeggibile non deve far saltare la mail.
      let invito = null
      if (p.calendario) {
        try { invito = leggiInvito(await scarica(client, m.uid, p.calendario), testo) } catch { invito = null }
      }
      const id = pulisciId(e.messageId) || `uid-${percorso}-${m.uid}@${IO}`
      const rif = listaId(m.headers ? new TextDecoder().decode(m.headers) : '')
      const risponde = listaId(e.inReplyTo)[0] || null
      const mia = indirizzo(e.from?.[0]) === IO
      righe.push({
        message_id: id, utente_id: UTENTE, area: 'G', cartella: mia ? 'inviata' : 'arrivata', cartella_imap: percorso,
        thread_key: rif[0] || risponde || id, in_reply_to: risponde, riferimenti: rif,
        da: indirizzo(e.from?.[0]), da_nome: e.from?.[0]?.name || null, a: indirizzi(e.to), cc: indirizzi(e.cc),
        oggetto: e.subject || null, data: e.date ? new Date(e.date).toISOString() : null,
        testo: testo.slice(0, 60000), allegati: p.allegati, fonte: 'imap', imap_uid: m.uid, invito,
      })
    } catch (e) {
      // Mail illeggibile: si salta, ma si conta (e si tiene il primo errore per capire).
      errori.n++
      errori.primo ||= `uid ${m.uid}: ${String((e as Error)?.message || e).slice(0, 200)}`
    }
  }
  return righe
}
const errori = { n: 0, primo: '' }

// Salva: se la mail c'era già (copiata dal gestionale) aggiorna i campi della casella e tiene cliente/cantiere/nota.
async function salva(tutte: Record<string, unknown>[]) {
  // La stessa mail può stare due volte nella stessa cartella: una sola riga per message_id.
  const righe = [...new Map(tutte.map((r) => [r.message_id, r])).values()]
  for (let i = 0; i < righe.length; i += 100) {
    await rest('posta?on_conflict=message_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(righe.slice(i, i + 100)),
    })
  }
}

async function leggi() {
  const password = Deno.env.get('GC_MAIL_PASSWORD')
  if (!password) return { saltato: 'manca GC_MAIL_PASSWORD' }
  const inizio = Date.now()
  const stati = new Map(((await rest('posta_stato?select=*')) as { cartella: string, uidvalidity: number, ultimo_uid: number, storico_uid: number | null }[])
    .map((s) => [s.cartella, s]))

  const client = new ImapFlow({
    host: 'imap.mail.hostpoint.ch', port: 993, secure: true,
    auth: { user: Deno.env.get('GC_MAIL_USER') || IO, pass: password },
    logger: false, emitLogs: false, connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 60000,
  })
  await client.connect()
  const esito: Record<string, unknown> = { nuove: 0, vecchie: 0, cartelle_lette: 0, storico_da_finire: 0 }
  const tempo = () => Date.now() - inizio
  try {
    // Tutte le cartelle (Giovanni archivia per cliente e cantiere: Archive/CLIENTI/<cliente>/<O0…>),
    // tranne cestino, spam e bozze. STATUS dice subito se ci sono mail nuove, senza aprire la cartella.
    const cartelle = (await client.list({ statusQuery: { uidNext: true, uidValidity: true, messages: true } }))
      .filter((b) => b.status && !ESCLUSE.test(b.path) && !b.flags?.has('\\Noselect'))
    // Prima INBOX e Inviata, poi le altre.
    cartelle.sort((x, y) => Number(!/^(INBOX|Sent)$/.test(x.path)) - Number(!/^(INBOX|Sent)$/.test(y.path)))

    const salvaStato = (s: Stato) => rest('posta_stato?on_conflict=cartella', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ ...s, modificata_il: new Date().toISOString() }),
    })

    // 1) Mail nuove in tutte le cartelle.
    const daStorico: [typeof cartelle[number], Stato][] = []
    for (const b of cartelle) {
      const validity = Number(b.status!.uidValidity)
      const prossimo = Number(b.status!.uidNext) - 1
      let s = stati.get(b.path) as Stato | undefined
      // Cartella mai vista: tutto quello che c'è è storico, si legge un pezzo alla volta.
      if (!s || Number(s.uidvalidity) !== validity) {
        s = { cartella: b.path, uidvalidity: validity, ultimo_uid: prossimo, storico_uid: b.status!.messages ? prossimo : 0 }
        await salvaStato(s)
      }
      if (s.storico_uid) daStorico.push([b, s])
      if (prossimo <= s.ultimo_uid || tempo() > LIMITE_MS) continue
      await client.mailboxOpen(b.path, { readOnly: true })
      const fino = Math.min(prossimo, s.ultimo_uid + PEZZO_NUOVE)
      const righe = await leggiBlocco(client, s.ultimo_uid + 1, fino, b.path, inizio + LIMITE_MS)
      await salva(righe)
      esito.nuove = Number(esito.nuove) + righe.length
      esito.cartelle_lette = Number(esito.cartelle_lette) + 1
      // Se il tempo è finito a metà, si riparte dall'ultima letta.
      s.ultimo_uid = tempo() < LIMITE_MS ? fino : Math.max(s.ultimo_uid, ...righe.map((r) => r.imap_uid))
      await salvaStato(s)
    }

    // 2) Storico, cartella per cartella, finché c'è tempo (un pezzo non finito si rilegge al giro dopo).
    for (const [b, s] of daStorico) {
      if (tempo() > LIMITE_MS * 0.5) break
      await client.mailboxOpen(b.path, { readOnly: true })
      while (s.storico_uid && tempo() < LIMITE_MS * 0.5) {
        const da = Math.max(1, s.storico_uid - PEZZO_STORICO + 1)
        const righe = await leggiBlocco(client, da, s.storico_uid, b.path, inizio + LIMITE_MS)
        await salva(righe)
        esito.vecchie = Number(esito.vecchie) + righe.length
        if (tempo() < LIMITE_MS) s.storico_uid = da === 1 ? 0 : da - 1
        await salvaStato(s)
      }
    }
    esito.storico_da_finire = daStorico.filter(([, s]) => s.storico_uid).length
  } finally {
    await client.logout().catch(() => client.close())
  }
  if (errori.n) esito.errori = { ...errori }
  esito.thread_allineati = await rpc('posta_allinea_thread')
  esito.bozze_annullate = await rpc('annulla_bozze_superate')
  return esito
}

Deno.serve(async (req: Request) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) {
    return new Response('Non autorizzato', { status: 401 })
  }
  const corpo = await req.clone().json().catch(() => ({}))
  // Una volta sola (14.10.2026): rilegge la parte calendario delle mail di INBOX degli ultimi N giorni,
  // arrivate prima che posta-gc sapesse leggere gli inviti. Non tocca le mail, aggiorna solo posta.invito.
  if (corpo?.inviti_giorni) {
    const c = new ImapFlow({ host: 'imap.mail.hostpoint.ch', port: 993, secure: true, logger: false,
      auth: { user: Deno.env.get('GC_MAIL_USER') || IO, pass: Deno.env.get('GC_MAIL_PASSWORD') || '' } })
    await c.connect()
    const trovati = []
    try {
      await c.mailboxOpen('INBOX', { readOnly: true })
      const uids = await c.search({ since: new Date(Date.now() - Number(corpo.inviti_giorni) * 864e5) }, { uid: true }) || []
      if (uids.length) {
        for (const m of await c.fetchAll(uids, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
          const p = parti(m.bodyStructure as Nodo)
          if (!p.calendario) continue
          const testo = p.testo ? await scarica(c, m.uid, p.testo) : p.html ? daHtml(await scarica(c, m.uid, p.html)) : ''
          const invito = leggiInvito(await scarica(c, m.uid, p.calendario), testo)
          const id = pulisciId(m.envelope?.messageId) || `uid-INBOX-${m.uid}@${IO}`
          if (invito) await rest(`posta?message_id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ invito }) })
          trovati.push({ oggetto: m.envelope?.subject, invito })
        }
      }
    } finally {
      await c.logout().catch(() => c.close())
    }
    return new Response(JSON.stringify(trovati), { headers: { 'Content-Type': 'application/json' } })
  }
  // Solo per controllo: elenco delle cartelle della casella con il numero di mail (non legge le mail).
  if (corpo?.cartelle) {
    const c = new ImapFlow({ host: 'imap.mail.hostpoint.ch', port: 993, secure: true, logger: false,
      auth: { user: Deno.env.get('GC_MAIL_USER') || IO, pass: Deno.env.get('GC_MAIL_PASSWORD') || '' } })
    await c.connect()
    const elenco = []
    for (const b of await c.list({ statusQuery: { messages: true } })) elenco.push({ cartella: b.path, mail: b.status?.messages, uso: b.specialUse })
    await c.logout()
    return new Response(JSON.stringify(elenco), { headers: { 'Content-Type': 'application/json' } })
  }
  const iniziata_il = new Date().toISOString()
  let esito
  try {
    const dettagli = await leggi()
    esito = { ok: !('saltato' in dettagli), dettagli, errore: 'saltato' in dettagli ? String(dettagli.saltato) : null }
  } catch (e) {
    esito = { ok: false, dettagli: null, errore: String((e as Error)?.message || e).slice(0, 500) }
  }
  await rest('lavori_registro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ lavoro: 'posta-gc', iniziata_il, ...esito }) })
    .catch(() => {})
  return new Response(JSON.stringify(esito), { status: esito.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
})
