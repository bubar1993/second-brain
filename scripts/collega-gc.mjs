// Prepara il collegamento G&C -> second brain. Non stampa mai i segreti.
// Crea una password nuova per l'utente di sola lettura "brain_lettore" del gestionale G&C e un token per l'agente G&C.
// Salva tra i segreti delle funzioni: GC_DB_URL, AGENTE_TOKEN, GC_MAIL_USER (la password della casella la mette Giovanni: GC_MAIL_PASSWORD).
// Scrive l'hash SCRAM della password in %TEMP%\brain-verifier-gc.txt: Claude lo usa per impostare la password
// nel gestionale G&C (ALTER ROLE ... PASSWORD '<hash>') e poi cancella il file.
// Il token dell'agente va anche nel prompt della routine "Agente G&C": lo scrive in %TEMP%\agente-token-gc.txt (Claude lo usa e lo cancella).
// Rilanciarlo cambia password e token: dopo va reimpostato l'hash in G&C e aggiornata la routine.
// Uso: node scripts/collega-gc.mjs   (serve SUPABASE_ACCESS_TOKEN)
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REF = 'vgurncqvgulldolhetyr'
const HOST = 'aws-0-eu-central-2.pooler.supabase.com'
const tokenApi = process.env.SUPABASE_ACCESS_TOKEN
if (!tokenApi) { console.log('ERRORE: manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }
const MGMT = { Authorization: `Bearer ${tokenApi}`, 'Content-Type': 'application/json' }

const password = randomBytes(24).toString('hex')
const agente = randomBytes(24).toString('hex')

// Hash SCRAM-SHA-256 nel formato di Postgres.
const sale = randomBytes(16)
const salata = pbkdf2Sync(password, sale, 4096, 32, 'sha256')
const hmac = (k, s) => createHmac('sha256', k).update(s).digest()
const stored = createHash('sha256').update(hmac(salata, 'Client Key')).digest()
const server = hmac(salata, 'Server Key')
writeFileSync(join(tmpdir(), 'brain-verifier-gc.txt'),
  `SCRAM-SHA-256$4096:${sale.toString('base64')}$${stored.toString('base64')}:${server.toString('base64')}`)
writeFileSync(join(tmpdir(), 'agente-token-gc.txt'), agente)

const url = `postgresql://brain_lettore.hnpesqsteytwfgrsrygn:${password}@${HOST}:6543/postgres`
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  method: 'POST', headers: MGMT,
  body: JSON.stringify([
    { name: 'GC_DB_URL', value: url },
    { name: 'AGENTE_TOKEN', value: agente },
    { name: 'GC_MAIL_USER', value: 'info@homeconcepts.ch' },
  ]),
})
console.log(r.ok ? 'Segreti della funzione: ok' : `ERRORE segreti: ${r.status}`)
console.log('Fatto. Ora dillo a Claude.')
