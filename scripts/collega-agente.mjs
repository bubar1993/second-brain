// Dà una password nuova a un utente-agente del second brain e salva i segreti per la funzione agente-sql.
// - gc (predefinito): "agente_gc", vede e scrive solo l'area G → segreto AGENTE_DB_URL.
// - lavoro: "agente_lavoro", aree C e G + smistamento Inbox → segreti AGENTE_DB_URL_LAVORO e AGENTE_TOKEN_LAVORO.
// - privato: "agente_privato", solo area P → segreti AGENTE_DB_URL_PRIVATO e AGENTE_TOKEN_PRIVATO.
// - calendario: "agente_calendario", solo eventi e nomi di ditte/persone → AGENTE_DB_URL_CALENDARIO e AGENTE_TOKEN_CALENDARIO.
// - ceramex: "agente_ceramex", solo area C (note clienti delle routine Bozze mail Ceramex) → AGENTE_DB_URL_CERAMEX e AGENTE_TOKEN_CERAMEX.
// - smistatore: "agente_smistatore", legge domande/richieste di lavoro e scrive richieste agli agenti → AGENTE_DB_URL_SMISTATORE e AGENTE_TOKEN_SMISTATORE.
// - seguire: "agente_seguire", promesse, campioni, circolari e doppioni di C e G → AGENTE_DB_URL_SEGUIRE e AGENTE_TOKEN_SEGUIRE.
// - capo: "agente_capo", Agente capo: legge e scrive tutto (tranne wa_collegamento), niente delete → AGENTE_DB_URL_CAPO e AGENTE_TOKEN_CAPO.
// Tranne gc, crea anche il token (variabile di Windows AGENTE_TOKEN_<NOME>) solo se manca.
// Imposta in Postgres solo l'hash SCRAM. Non stampa mai i segreti.
// Uso: node scripts/collega-agente.mjs [gc|lavoro|privato|calendario|ceramex|smistatore|seguire|capo]   (serve SUPABASE_ACCESS_TOKEN)
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto'
import { execSync } from 'node:child_process'

const REF = 'vgurncqvgulldolhetyr'
const HOST = 'aws-0-eu-central-2.pooler.supabase.com'
const tokenApi = process.env.SUPABASE_ACCESS_TOKEN
if (!tokenApi) { console.log('ERRORE: manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const MGMT = { Authorization: `Bearer ${tokenApi}`, 'Content-Type': 'application/json' }

const quale = process.argv[2] || 'gc'
if (!['gc', 'lavoro', 'privato', 'calendario', 'ceramex', 'smistatore', 'seguire', 'capo'].includes(quale)) { console.log('Uso: node scripts/collega-agente.mjs [gc|lavoro|privato|calendario|ceramex|smistatore|seguire|capo]'); process.exit(1) }
const ruolo = `agente_${quale}`
const suffisso = quale === 'gc' ? '' : `_${quale.toUpperCase()}`

const password = randomBytes(24).toString('hex')
const sale = randomBytes(16)
const salata = pbkdf2Sync(password, sale, 4096, 32, 'sha256')
const hmac = (k, s) => createHmac('sha256', k).update(s).digest()
const stored = createHash('sha256').update(hmac(salata, 'Client Key')).digest()
const server = hmac(salata, 'Server Key')
const hash = `SCRAM-SHA-256$4096:${sale.toString('base64')}$${stored.toString('base64')}:${server.toString('base64')}`

let r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: MGMT,
  body: JSON.stringify({ query: `alter role ${ruolo} login password '${hash}';
    alter role ${ruolo} set statement_timeout = '20s';` }),
})
console.log(r.ok ? `Password ${ruolo}: ok` : `ERRORE password: ${r.status}`)

const segreti = [{ name: `AGENTE_DB_URL${suffisso}`, value: `postgresql://${ruolo}.${REF}:${password}@${HOST}:6543/postgres` }]
if (quale !== 'gc') {
  const nome = `AGENTE_TOKEN${suffisso}`
  const leggiWin = () => execSync(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${nome}','User')"`, { encoding: 'utf8' }).trim()
  let token = leggiWin()
  if (!token) {
    token = randomBytes(24).toString('hex')
    execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('${nome}','${token}','User')"`)
    console.log(`Creato il token (variabile di Windows ${nome}).`)
  }
  segreti.push({ name: nome, value: token })
}

r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, { method: 'POST', headers: MGMT, body: JSON.stringify(segreti) })
console.log(r.ok ? `Segreti salvati: ${segreti.map((s) => s.name).join(', ')}` : `ERRORE segreti: ${r.status}`)
