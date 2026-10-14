// Salva la chiave API di Anthropic (crediti del piano Max) per la risposta dell'AI in Chiedi (funzione chiedi-ai).
// Giovanni crea la chiave nella Console Claude (platform.claude.com → organizzazione collegata al piano → API keys →
// Create key) e la copia negli appunti del PC; questo script la legge dagli appunti, controlla che funzioni (elenco
// dei modelli, non costa niente), la salva come segreto ANTHROPIC_API_KEY nel second brain e svuota gli appunti.
// Non stampa mai la chiave. Uso: node scripts/salva-chiave-api.mjs   (serve SUPABASE_ACCESS_TOKEN)
import { execSync } from 'node:child_process'

const REF = 'vgurncqvgulldolhetyr'
const MODELLI = ['claude-sonnet-5-5', 'claude-haiku-5-5'] // quelli che usa chiedi-ai
const tokenApi = process.env.SUPABASE_ACCESS_TOKEN
if (!tokenApi) { console.log('ERRORE: manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }

const svuota = () => execSync('powershell -NoProfile -Command Set-Clipboard -Value $null')
const chiave = execSync('powershell -NoProfile -Command Get-Clipboard', { encoding: 'utf8' }).trim()
// La Console dà chiavi sk-ant-api03-… oppure (dal 2026) sk-ant-usr-…: vanno bene tutte e due.
if (!/^sk-ant-(api03|usr)-[A-Za-z0-9_-]{20,}$/.test(chiave)) {
  console.log('Negli appunti non c\'è una chiave API (deve cominciare con sk-ant-api03- o sk-ant-usr-). Niente salvato.')
  process.exit(1)
}

const m = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': chiave, 'anthropic-version': '2023-06-01' } })
if (!m.ok) { svuota(); console.log(`La chiave non funziona (errore ${m.status}). Niente salvato. Appunti svuotati.`); process.exit(1) }
const ids = ((await m.json()).data || []).map((x) => x.id)
for (const id of MODELLI) console.log(`${id}: ${ids.includes(id) ? 'c\'è' : 'NON c\'è (da correggere in chiedi-ai)'}`)

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tokenApi}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: 'ANTHROPIC_API_KEY', value: chiave }]),
})
svuota()
console.log(r.ok ? 'Salvata ANTHROPIC_API_KEY. Appunti svuotati.' : `ERRORE ${r.status}: niente salvato. Appunti svuotati.`)
process.exit(r.ok ? 0 : 1)
