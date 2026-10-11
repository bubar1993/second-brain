// Porta del database per l'agente G&C: manda l'SQL alla funzione agente-sql (vede e scrive solo l'area G).
// Uso:  node scripts/agente-sql.mjs "select ..."      oppure      node scripts/agente-sql.mjs file.sql
// Il token si legge dalla variabile d'ambiente di Windows AGENTE_TOKEN_GC (mai scriverlo in file del progetto).
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

let token = process.env.AGENTE_TOKEN_GC
if (!token && process.platform === 'win32') {
  try {
    token = execSync(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('AGENTE_TOKEN_GC','User')"`).toString().trim()
  } catch { /* sotto si spiega */ }
}
if (!token) { console.log('ERRORE: manca la variabile AGENTE_TOKEN_GC'); process.exit(1) }

const arg = process.argv[2]
if (!arg) { console.log('Uso: node scripts/agente-sql.mjs "select ..." | file.sql'); process.exit(1) }
const sql = arg.endsWith('.sql') && existsSync(arg) ? readFileSync(arg, 'utf8') : arg

const r = await fetch('https://vgurncqvgulldolhetyr.supabase.co/functions/v1/agente-sql', {
  method: 'POST', headers: { 'x-agente-token': token, 'Content-Type': 'text/plain; charset=utf-8' }, body: sql,
})
const testo = await r.text()
console.log(r.ok ? testo : `ERRORE ${r.status}: ${testo}`)
if (!r.ok) process.exit(1)
