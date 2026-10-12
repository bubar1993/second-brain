// Collega la Gmail di Giovanni (giovannifabris@ceramex.ch) al second brain, per inviare dall'app
// le bozze Ceramex (funzione gmail-bozza). Consenso nel browser → refresh token → segreto GMAIL_REFRESH_TOKEN.
// Client OAuth "Second Brain Gmail" (tipo App desktop) nel progetto Google "Ceramex Gestionale",
// pubblico Interno: il collegamento non scade dopo 7 giorni. Segreti GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN.
// Uso: node scripts/collega-gmail.mjs <file client_secret.json>   (richiede SUPABASE_ACCESS_TOKEN)
// Non stampa mai i valori segreti.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { exec } from 'node:child_process'

const REF = 'vgurncqvgulldolhetyr'
// Solo l'oggetto JSON iniziale del file (dopo può esserci altro); in caso di errore non si stampa il contenuto.
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
  // compose = creare, correggere e inviare bozze; readonly = leggere la mail a cui si risponde.
  scope: 'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly',
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

  // Verifica: la Gmail risponde ed è quella giusta? (se l'API Gmail non è attiva nel progetto Google, lo dice qui)
  const p = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tok.access_token}` } })
  const profilo = p.ok ? await p.json() : null
  console.log('Gmail raggiungibile: ' + p.ok + (profilo ? ' (' + profilo.emailAddress + ')' : ' (' + p.status + ' ' + (await p.text()).slice(0, 300) + ')'))

  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { name: 'GMAIL_CLIENT_ID', value: client_id },
      { name: 'GMAIL_CLIENT_SECRET', value: client_secret },
      { name: 'GMAIL_REFRESH_TOKEN', value: tok.refresh_token },
    ]),
  })
  console.log('Segreto salvato in Supabase: ' + r.ok + (r.ok ? '' : ' ' + r.status + ' ' + (await r.text()).slice(0, 200)))
  process.exit(r.ok ? 0 : 1)
})
