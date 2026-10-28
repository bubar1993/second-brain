// Permesso di SOLA LETTURA sul Google Calendar di Giovanni (giovannifabris@ceramex.ch) per il portinaio (26.10.2026):
// così l'agente calendario si sveglia solo quando in Google cambia qualcosa, invece che ogni ora.
// Stesso client OAuth "Second Brain Gmail", permesso a parte SOLO calendar.readonly: Gmail e Contatti non si toccano.
// Google non fa più scaricare la chiave del client: lo scambio del codice lo fa la funzione `collega-calendario`
// (che la chiave ce l'ha), con PKCE. Qui servono solo il clic di Giovanni e SUPABASE_ACCESS_TOKEN.
// Uso: node scripts/collega-calendario.mjs   → si apre Google, Giovanni clicca Consenti.
//      node scripts/collega-calendario.mjs scrittura   → (28.10.2026, tappa 2) permesso di creare e cambiare eventi
//      (calendar.events + email per controllare l'account), segreto CALENDARIO_SCRIVI_TOKEN.
// Non stampa mai valori segreti.
import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'

const FUNZIONE = 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/collega-calendario'
const SB = process.env.SUPABASE_ACCESS_TOKEN
if (!SB) { console.log('Manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const tipo = process.argv[2] === 'scrittura' ? 'scrittura' : 'lettura'
const chiama = async (corpo) => (await fetch(FUNZIONE, {
  method: 'POST', headers: { 'x-supabase-pat': SB, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...corpo, tipo }),
})).json()

const inizio = await chiama({ azione: 'inizio' })
if (!inizio.ok) { console.log('La funzione non risponde: ' + (inizio.errore || 'errore')); process.exit(1) }

const verifier = randomBytes(48).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')
const server = createServer()
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const redirect = `http://127.0.0.1:${server.address().port}`
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: inizio.client_id, redirect_uri: redirect, response_type: 'code', scope: inizio.scope,
  access_type: 'offline', prompt: 'consent', login_hint: 'giovannifabris@ceramex.ch',
  code_challenge: challenge, code_challenge_method: 'S256',
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
  const fine = await chiama({ azione: 'fine', code: q.get('code'), redirect_uri: redirect, code_verifier: verifier })
  console.log(fine.ok ? 'Calendario raggiungibile e segreto salvato in Supabase.'
    : 'Non riuscito: ' + fine.errore + (fine.link ? '\nAttiva l\'API qui: ' + fine.link : ''))
  process.exit(fine.ok ? 0 : 1)
})
