// Prepara la copia automatica Ceramex -> second brain. Non stampa mai i segreti.
// Crea una password nuova per l'utente di sola lettura "brain_lettore" del gestionale Ceramex e un token per pg_cron.
// Salva: CERAMEX_DB_URL e COPIA_TOKEN tra i segreti delle funzioni, il token anche nel Vault ("copia_token").
// Scrive solo l'hash SCRAM della password in %TEMP%\brain-verifier.txt: Claude lo usa per impostare la password
// in Ceramex (ALTER ROLE ... PASSWORD '<hash>') e poi cancella il file.
// Rilanciarlo cambia password e token: dopo va reimpostato l'hash in Ceramex.
// Uso: node scripts/collega-ceramex.mjs   (serve SUPABASE_ACCESS_TOKEN)
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
const token = randomBytes(24).toString('hex')

// Hash SCRAM-SHA-256 nel formato di Postgres.
const sale = randomBytes(16)
const salata = pbkdf2Sync(password, sale, 4096, 32, 'sha256')
const hmac = (k, s) => createHmac('sha256', k).update(s).digest()
const stored = createHash('sha256').update(hmac(salata, 'Client Key')).digest()
const server = hmac(salata, 'Server Key')
const fileHash = join(tmpdir(), 'brain-verifier.txt')
writeFileSync(fileHash, `SCRAM-SHA-256$4096:${sale.toString('base64')}$${stored.toString('base64')}:${server.toString('base64')}`)

const url = `postgresql://brain_lettore.nouxqowregwnyqlrvqqo:${password}@${HOST}:6543/postgres`
let r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  method: 'POST', headers: MGMT,
  body: JSON.stringify([{ name: 'CERAMEX_DB_URL', value: url }, { name: 'COPIA_TOKEN', value: token }]),
})
console.log(r.ok ? 'Segreti della funzione: ok' : `ERRORE segreti: ${r.status}`)

r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: MGMT,
  body: JSON.stringify({ query: `do $$ begin
    if exists (select 1 from vault.secrets where name = 'copia_token') then
      perform vault.update_secret((select id from vault.secrets where name = 'copia_token'), '${token}');
    else
      perform vault.create_secret('${token}', 'copia_token', 'Chiamata della funzione copia-ceramex da pg_cron');
    end if; end $$` }),
})
console.log(r.ok ? 'Vault: ok' : `ERRORE Vault: ${r.status}`)
console.log('Fatto. Ora dillo a Claude.')
