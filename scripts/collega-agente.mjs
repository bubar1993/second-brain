// Dà una password nuova all'utente "agente_gc" del second brain (vede e scrive solo l'area G).
// Imposta in Postgres solo l'hash SCRAM e salva l'indirizzo completo come segreto AGENTE_DB_URL
// (lo usa la funzione agente-sql). Non stampa mai i segreti.
// Uso: node scripts/collega-agente.mjs   (serve SUPABASE_ACCESS_TOKEN)
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto'

const REF = 'vgurncqvgulldolhetyr'
const HOST = 'aws-0-eu-central-2.pooler.supabase.com'
const tokenApi = process.env.SUPABASE_ACCESS_TOKEN
if (!tokenApi) { console.log('ERRORE: manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const MGMT = { Authorization: `Bearer ${tokenApi}`, 'Content-Type': 'application/json' }

const password = randomBytes(24).toString('hex')
const sale = randomBytes(16)
const salata = pbkdf2Sync(password, sale, 4096, 32, 'sha256')
const hmac = (k, s) => createHmac('sha256', k).update(s).digest()
const stored = createHash('sha256').update(hmac(salata, 'Client Key')).digest()
const server = hmac(salata, 'Server Key')
const hash = `SCRAM-SHA-256$4096:${sale.toString('base64')}$${stored.toString('base64')}:${server.toString('base64')}`

let r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: MGMT,
  body: JSON.stringify({ query: `alter role agente_gc login password '${hash}';
    alter role agente_gc set statement_timeout = '20s';` }),
})
console.log(r.ok ? 'Password agente_gc: ok' : `ERRORE password: ${r.status}`)

r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  method: 'POST', headers: MGMT,
  body: JSON.stringify([{ name: 'AGENTE_DB_URL', value: `postgresql://agente_gc.${REF}:${password}@${HOST}:6543/postgres` }]),
})
console.log(r.ok ? 'Segreto AGENTE_DB_URL: ok' : `ERRORE segreto: ${r.status}`)
