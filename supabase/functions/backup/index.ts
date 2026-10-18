// Supabase Edge Function: backup (Second Brain)
//
// Backup settimanale su Google Drive, cartella BRAIN/Backup. Chiamata la domenica notte da pg_cron
// con l'intestazione "x-backup-token" (chiave nel Vault del database e nel segreto BACKUP_TOKEN).
//   brain-dati-AAAA-MM-GG.json.gz   → tutti i dati (tranne "vettori", che si ricalcolano), letti a pezzi
//   brain-struttura-AAAA-MM-GG.sql  → la struttura (per ricostruire il database da zero)
//   Foto/                           → solo le foto nuove, una volta sola ciascuna
// Dati e struttura si tengono 90 giorni (poi nel cestino di Drive). Le foto restano.
// L'esito finisce in public.backup_registro: se qualcosa va storto l'app lo mostra in Oggi.
// Verify JWT disattivato: l'autorizzazione è la chiave BACKUP_TOKEN.
//
// Con { "ceramex_note": true } fa invece una copia una tantum delle note del gestionale Ceramex
// (trasloco, passo 3, 13.10.2026), letta con brain_lettore: ceramex-note-AAAA-MM-GG.json.gz (tutto)
// e ceramex-note-AAAA-MM-GG.csv (da leggere in Fogli Google). Il nome non inizia con "brain-": la pulizia dei 90 giorni non li tocca.
import postgres from 'npm:postgres@3.4.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BACKUP_TOKEN = Deno.env.get('BACKUP_TOKEN')
const GDRIVE_CLIENT_ID = Deno.env.get('GDRIVE_CLIENT_ID')
const GDRIVE_CLIENT_SECRET = Deno.env.get('GDRIVE_CLIENT_SECRET')
const GDRIVE_REFRESH_TOKEN = Deno.env.get('GDRIVE_REFRESH_TOKEN')
const GDRIVE_FOLDER_ID = Deno.env.get('GDRIVE_FOLDER_ID')

const GIORNI_DA_TENERE = 90
// Dati letti tabella per tabella, 500 righe alla volta (18.10.2026): tutto in una volta superava gli 8 s del database.
const RIGHE_PER_PEZZO = 500
// "vettori" (ricerca per significato) non va nel backup: si ricalcola dalle note ed è la tabella più pesante.
const TABELLE_ESCLUSE = ['vettori']
const FOTO_PER_GIRO = 200
const CARTELLA_MIME = 'application/vnd.google-apps.folder'
const TUTTI_I_DRIVE = 'supportsAllDrives=true&includeItemsFromAllDrives=true'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }

async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: sbHeaders, body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return await r.json()
}

async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const testo = await r.text()
  return testo ? JSON.parse(testo) : null
}

async function registra(ok: boolean, dettagli: unknown, errore: string | null) {
  try {
    await rest('backup_registro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ok, dettagli, errore }) })
  } catch (e) {
    console.error('backup: registro non scritto', e)
  }
}

async function tokenGoogle(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GDRIVE_CLIENT_ID!, client_secret: GDRIVE_CLIENT_SECRET!,
      refresh_token: GDRIVE_REFRESH_TOKEN!, grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) throw new Error('Collegamento Google scaduto o revocato (' + r.status + ')')
  return (await r.json()).access_token
}

const q = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function elenco(token: string, cond: string, campi = 'files(id,name,createdTime)') {
  const out: any[] = []
  let pagina = ''
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(cond)}&fields=nextPageToken,${campi}&pageSize=100&${TUTTI_I_DRIVE}${pagina ? '&pageToken=' + encodeURIComponent(pagina) : ''}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) throw new Error('Elenco Drive non riuscito: ' + (await r.text()).slice(0, 200))
    const d = await r.json()
    out.push(...(d.files || []))
    pagina = d.nextPageToken || ''
  } while (pagina)
  return out
}

async function cartella(token: string, nome: string, padre: string): Promise<string> {
  const trovata = await elenco(token, `name = '${q(nome)}' and '${q(padre)}' in parents and mimeType = '${CARTELLA_MIME}' and trashed = false`, 'files(id)')
  if (trovata[0]) return trovata[0].id
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?fields=id&${TUTTI_I_DRIVE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, mimeType: CARTELLA_MIME, parents: [padre] }),
  })
  if (!r.ok) throw new Error(`Cartella ${nome} non creata: ` + (await r.text()).slice(0, 200))
  return (await r.json()).id
}

async function cestina(token: string, id: string) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${TUTTI_I_DRIVE}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

async function carica(token: string, nome: string, padre: string, bytes: Uint8Array, mime: string): Promise<string> {
  const confine = 'brain_' + crypto.randomUUID().replace(/-/g, '')
  const enc = new TextEncoder()
  const prima = enc.encode(
    `--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nome, parents: [padre] })}\r\n` +
    `--${confine}\r\nContent-Type: ${mime}\r\n\r\n`,
  )
  const dopo = enc.encode(`\r\n--${confine}--`)
  const corpo = new Uint8Array(prima.length + bytes.length + dopo.length)
  corpo.set(prima, 0)
  corpo.set(bytes, prima.length)
  corpo.set(dopo, prima.length + bytes.length)
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&${TUTTI_I_DRIVE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${confine}` },
    body: corpo,
  })
  if (!r.ok) throw new Error(`Caricamento ${nome} non riuscito: ` + (await r.text()).slice(0, 200))
  return (await r.json()).id
}

// Se nello stesso giorno c'era già un file con lo stesso nome, il vecchio va nel cestino.
async function sostituisci(token: string, padre: string, nome: string, bytes: Uint8Array, mime: string) {
  const vecchi = await elenco(token, `name = '${q(nome)}' and '${q(padre)}' in parents and trashed = false`)
  const id = await carica(token, nome, padre, bytes, mime)
  for (const f of vecchi) await cestina(token, f.id)
  return id
}

async function gzip(testo: string): Promise<Uint8Array> {
  const flusso = new Blob([testo]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(flusso).arrayBuffer())
}

const csvCampo = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function backupNoteCeramex(giorno: string) {
  const sql = postgres(Deno.env.get('CERAMEX_DB_URL')!, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5 })
  let clienti, note, regole, viste
  try {
    clienti = await sql`select * from clienti order by nome`
    note = await sql`select * from note_clienti order by cliente_id, data, creato_il`
    regole = await sql`select * from note_regole order by creato_il`
    viste = await sql`select * from note_mail_viste order by visto_il`
  } finally {
    sql.end({ timeout: 2 }).catch(() => {})
  }
  const conteggi = { clienti: clienti.length, note_clienti: note.length, note_regole: regole.length, note_mail_viste: viste.length }
  const token = await tokenGoogle()
  const dati = await gzip(JSON.stringify({
    creato_il: new Date().toISOString(), fonte: 'Gestionale Ceramex (Supabase nouxqowregwnyqlrvqqo), prima di cancellare le note',
    conteggi, tabelle: { clienti, note_clienti: note, note_regole: regole, note_mail_viste: viste },
  }))
  const nomeDati = `ceramex-note-${giorno}.json.gz`
  await sostituisci(token, GDRIVE_FOLDER_ID!, nomeDati, dati, 'application/gzip')

  const nomeCliente = new Map(clienti.map((c) => [c.id, c.nome]))
  const righe = [['Cliente', 'Mandante', 'Sezione', 'Data', 'Persona', 'Testo', 'Risolto il', 'Scartata il', 'Fonte']]
  for (const n of note) {
    righe.push([nomeCliente.get(n.cliente_id) || '', n.mandante, n.sezione, n.data, n.persona, n.testo, n.risolto_il, n.scartata_il, n.fonte])
  }
  // BOM: così Fogli ed Excel leggono bene accenti e umlaut.
  const csv = '﻿' + righe.map((r) => r.map(csvCampo).join(',')).join('\r\n')
  const nomeCsv = `ceramex-note-${giorno}.csv`
  await sostituisci(token, GDRIVE_FOLDER_ID!, nomeCsv, new TextEncoder().encode(csv), 'text/csv; charset=UTF-8')
  return { file: [nomeDati, nomeCsv], kb: Math.round(dati.length / 1024), righe: conteggi }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Metodo non permesso.' }, 405)
  if (!BACKUP_TOKEN || req.headers.get('x-backup-token') !== BACKUP_TOKEN) {
    return json({ ok: false, error: 'Accesso non autorizzato.' }, 401)
  }
  if (!GDRIVE_CLIENT_ID || !GDRIVE_CLIENT_SECRET || !GDRIVE_REFRESH_TOKEN || !GDRIVE_FOLDER_ID) {
    await registra(false, null, 'Configurazione Google incompleta')
    return json({ ok: false, error: 'Configurazione incompleta.' }, 500)
  }

  const corpo = await req.json().catch(() => ({}))
  if (corpo?.ceramex_note) {
    try {
      return json({ ok: true, ...(await backupNoteCeramex(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }))) })
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message || e) }, 500)
    }
  }

  const ora = new Date()
  const giorno = ora.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }) // AAAA-MM-GG
  const dettagli: Record<string, unknown> = { giorno }

  try {
    const token = await tokenGoogle()

    // 1. Dati
    const tabelle: Record<string, unknown[]> = {}
    for (const t of (await rpc('backup_tabelle')) as string[]) {
      if (TABELLE_ESCLUSE.includes(t)) continue
      const righe: unknown[] = []
      for (let da = 0; ; da += RIGHE_PER_PEZZO) {
        const pezzo = (await rpc('backup_export_pezzo', { p_tabella: t, p_da: da, p_quanti: RIGHE_PER_PEZZO })) as unknown[]
        righe.push(...pezzo)
        if (pezzo.length < RIGHE_PER_PEZZO) break
      }
      tabelle[t] = righe
    }
    dettagli.escluse = TABELLE_ESCLUSE
    const conteggi: Record<string, number> = {}
    for (const [t, righe] of Object.entries(tabelle)) conteggi[t] = righe.length
    const dati = await gzip(JSON.stringify({ creato_il: ora.toISOString(), fonte: 'Second Brain (Supabase vgurncqvgulldolhetyr)', conteggi, tabelle }))
    const nomeDati = `brain-dati-${giorno}.json.gz`
    await sostituisci(token, GDRIVE_FOLDER_ID, nomeDati, dati, 'application/gzip')
    dettagli.dati = { file: nomeDati, kb: Math.round(dati.length / 1024), righe: conteggi }

    // 2. Struttura (se non riesce, i dati restano salvati)
    try {
      const sql = await rpc('backup_schema')
      if (typeof sql !== 'string' || sql.length < 500) throw new Error('struttura vuota')
      const nome = `brain-struttura-${giorno}.sql`
      await sostituisci(token, GDRIVE_FOLDER_ID, nome, new TextEncoder().encode(sql), 'text/plain; charset=UTF-8')
      dettagli.struttura = nome
    } catch (e) {
      dettagli.struttura_errore = String((e as Error)?.message || e)
    }

    // 3. Foto nuove
    const fatte = new Set((await rest('backup_foto?select=percorso') as { percorso: string }[]).map((f) => f.percorso))
    const tutte = await rest('allegati?select=percorso&order=creata_il') as { percorso: string }[]
    const daFare = tutte.filter((a) => !fatte.has(a.percorso))
    const nuove = daFare.slice(0, FOTO_PER_GIRO)
    let copiate = 0
    const nonRiuscite: string[] = []
    if (nuove.length) {
      const cartellaFoto = await cartella(token, 'Foto', GDRIVE_FOLDER_ID)
      for (const { percorso } of nuove) {
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/allegati/${percorso.split('/').map(encodeURIComponent).join('/')}`, {
          headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        })
        if (!r.ok) { nonRiuscite.push(`${percorso} (${r.status})`); continue }
        const nome = percorso.split('/').slice(1).join('_') // <nota>_<file>.jpg
        const id = await carica(token, nome, cartellaFoto, new Uint8Array(await r.arrayBuffer()), r.headers.get('Content-Type') || 'image/jpeg')
        await rest('backup_foto', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ percorso, drive_id: id }) })
        copiate++
      }
    }
    dettagli.foto = { copiate, da_copiare_ancora: daFare.length - copiate, non_riuscite: nonRiuscite.slice(0, 10) }
    if (nonRiuscite.length) throw new Error(`${nonRiuscite.length} foto non copiate`)

    // 4. Pulizia: dati e struttura più vecchi di 90 giorni nel cestino di Drive
    const limite = new Date(ora.getTime() - GIORNI_DA_TENERE * 86400000).toISOString()
    const vecchi = await elenco(token, `'${q(GDRIVE_FOLDER_ID)}' in parents and trashed = false and name contains 'brain-' and createdTime < '${limite}'`)
    for (const f of vecchi) await cestina(token, f.id)
    dettagli.vecchi_nel_cestino = vecchi.length

    await registra(true, dettagli, null)
    console.log('backup', JSON.stringify(dettagli))
    return json({ ok: true, ...dettagli })
  } catch (e) {
    const errore = String((e as Error)?.message || e)
    console.error('backup errore', errore)
    await registra(false, dettagli, errore)
    return json({ ok: false, error: errore }, 500)
  }
})
