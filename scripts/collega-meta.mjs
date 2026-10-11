// WhatsApp (fase 7): salva i segreti dell'app Meta "Second Brain GF" nel second brain. Non stampa mai i segreti.
// - WA_APP_SECRET: la "Chiave segreta" dell'app (Impostazioni app → Di base). Giovanni la copia
//   negli appunti, poi si lancia questo script: la legge dagli appunti e la salva come segreto.
// - WA_VERIFY_TOKEN: parola di controllo per il webhook (si crea qui la prima volta, si salva anche
//   come variabile di Windows perché va scritta nel modulo webhook di Meta).
// - WA_COLLEGA_TOKEN: chiave per lanciare la funzione whatsapp-collega (anche variabile di Windows).
// Uso: node scripts/collega-meta.mjs   (serve SUPABASE_ACCESS_TOKEN)
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const REF = 'vgurncqvgulldolhetyr'
const tokenApi = process.env.SUPABASE_ACCESS_TOKEN
if (!tokenApi) { console.log('ERRORE: manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const MGMT = { Authorization: `Bearer ${tokenApi}`, 'Content-Type': 'application/json' }

const segreti = []
const appunti = execSync('powershell -NoProfile -Command Get-Clipboard', { encoding: 'utf8' }).trim()
if (/^[0-9a-f]{32}$/i.test(appunti)) {
  segreti.push({ name: 'WA_APP_SECRET', value: appunti })
  execSync('powershell -NoProfile -Command Set-Clipboard -Value $null')
  console.log('Chiave segreta Meta trovata negli appunti (poi svuotati).')
} else {
  console.log('Negli appunti non c\'è la chiave segreta Meta (32 caratteri): WA_APP_SECRET non cambia.')
}

const leggiWin = (n) => execSync(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${n}','User')"`, { encoding: 'utf8' }).trim()
let verifica = leggiWin('WA_VERIFY_TOKEN')
if (!verifica) {
  verifica = 'sb-' + randomBytes(12).toString('hex')
  execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('WA_VERIFY_TOKEN','${verifica}','User')"`)
  console.log('Creata la parola di controllo del webhook (variabile di Windows WA_VERIFY_TOKEN).')
}
segreti.push({ name: 'WA_VERIFY_TOKEN', value: verifica })

// Chiave per lanciare whatsapp-collega dal PC (variabile di Windows WA_COLLEGA_TOKEN).
let collega = leggiWin('WA_COLLEGA_TOKEN')
if (!collega) {
  collega = randomBytes(24).toString('hex')
  execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('WA_COLLEGA_TOKEN','${collega}','User')"`)
  console.log('Creata la chiave per l\'aggancio (variabile di Windows WA_COLLEGA_TOKEN).')
}
segreti.push({ name: 'WA_COLLEGA_TOKEN', value: collega })

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, { method: 'POST', headers: MGMT, body: JSON.stringify(segreti) })
console.log(r.ok ? `Segreti salvati: ${segreti.map((s) => s.name).join(', ')}` : `ERRORE segreti: ${r.status}`)
