// Permesso di SOLA LETTURA sul Google Calendar di Giovanni (giovannifabris@ceramex.ch) per il portinaio (26.10.2026):
// così l'agente calendario si sveglia solo quando in Google cambia qualcosa, invece che ogni ora.
// Stesso client OAuth "Second Brain Gmail" (pubblico Interno, non scade dopo 7 giorni), permesso a parte SOLO
// calendar.readonly: Gmail e Contatti non si toccano. Consenso nel browser → segreto CALENDARIO_REFRESH_TOKEN.
// Uso: node scripts/collega-calendario.mjs <file client_secret.json>   (richiede SUPABASE_ACCESS_TOKEN)
// Se l'API Calendar non è attiva nel progetto Google, lo dice alla fine con il link per attivarla.
// Non stampa mai i valori segreti.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { exec } from 'node:child_process'

const REF = 'vgurncqvgulldolhetyr'
let client_id, client_secret
try {
  const t = readFileSync(process.argv[2], 'utf8')
  ;({ client_id, client_secret } = JSON.parse(t.slice(t.indexOf('{'), t.indexOf('}}') + 2)).installed)
  if (!client_id || !client_secret) throw new Error()
} catch {
  console.log('Non riesco a leggere il file del client Google.')
  process.exit(1)
}
const SB = process.env.SUPABASE_ACCESS_TOKEN
if (!SB) { console.log('Manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }

const server = createServer()
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const redirect = `http://127.0.0.1:${server.address().port}`
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id, redirect_uri: redirect, response_type: 'code',
  scope: 'https://www.googleapis.com/auth/calendar.readonly',
  access_type: 'offline', prompt: 'consent', login_hint: 'giovannifabris@ceramex.ch',
})
exec(`start "" "${url}"`)
console.log('Pagina Google aperta, aspetto il consenso…')

const timer = setTimeout(() => { console.log('Tempo scaduto (10 minuti).'); process.exit(1) }, 600000)

server.on('request', async (req, res) => {
  const q = new URL(req.url, redirect).searchParams
  if (!q.get('code') && !q.get('error')) { res.end(); return }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  if (q.get('error')) {
    res.end('<h2>Collegamento annullato.</h2>')
    console.log('Consenso negato: ' + q.get('error'))
    process.exit(1)
  }
  res.end('<h2 style="font-family:sans-serif">Fatto. Puoi chiudere questa pagina.</h2>')
  clearTimeout(timer)
  server.close()

  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: q.get('code'), client_id, client_secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  })).json()
  if (!tok.refresh_token) { console.log('Nessun refresh token ricevuto: ' + (tok.error || 'sconosciuto')); process.exit(1) }

  // Verifica prima di salvare: il calendario risponde? (se l'API Calendar non è attiva, Google dà il link)
  const c = await fetch('https://www.googleapis.com/calendar/v3/calendars/giovannifabris%40ceramex.ch/events?maxResults=1&fields=items(id)',
    { headers: { Authorization: `Bearer ${tok.access_token}` } })
  if (!c.ok) {
    const t = await c.text()
    const link = t.match(/https:\/\/console\.developers\.google\.com\/[^\s"]+/)?.[0]
    console.log('Calendario raggiungibile: false (' + c.status + ')' + (link ? '\nAttiva l\'API qui: ' + link : ' ' + t.slice(0, 300)))
    process.exit(1)
  }
  console.log('Calendario raggiungibile: true')

  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'CALENDARIO_REFRESH_TOKEN', value: tok.refresh_token }]),
  })
  console.log('Segreto salvato in Supabase: ' + r.ok + (r.ok ? '' : ' ' + r.status + ' ' + (await r.text()).slice(0, 200)))
  process.exit(r.ok ? 0 : 1)
})
