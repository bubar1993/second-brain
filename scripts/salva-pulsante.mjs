// Salva il token del "pulsante remoto" (trigger API) di una routine, per il "Fallo adesso" dell'app.
// Giovanni genera il token su claude.ai (routine → Edit → Add another trigger → API → Generate token)
// e lo copia negli appunti; questo script lo legge dagli appunti, lo salva come segreto
// ROUTINE_TOKEN_<AGENTE> nel second brain e svuota gli appunti. Non stampa mai il token.
// Uso: node scripts/salva-pulsante.mjs <lavoro|ceramex|gc|calendario|privato|archiviazione|smistatore|seguire>   (serve SUPABASE_ACCESS_TOKEN)
import { execSync } from 'node:child_process'

const REF = 'vgurncqvgulldolhetyr'
const agente = process.argv[2]
if (!['lavoro', 'ceramex', 'gc', 'calendario', 'privato', 'archiviazione', 'smistatore', 'seguire'].includes(agente)) {
  console.log('Uso: node scripts/salva-pulsante.mjs <lavoro|ceramex|gc|calendario|privato|archiviazione|smistatore|seguire>')
  process.exit(1)
}
const tokenApi = process.env.SUPABASE_ACCESS_TOKEN
if (!tokenApi) { console.log('ERRORE: manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }

const appunti = execSync('powershell -NoProfile -Command Get-Clipboard', { encoding: 'utf8' }).trim()
if (!/^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/.test(appunti)) {
  console.log('Negli appunti non c\'è un token di routine (deve cominciare con sk-ant-oat01-). Niente salvato.')
  process.exit(1)
}
const nome = `ROUTINE_TOKEN_${agente.toUpperCase()}`
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tokenApi}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: nome, value: appunti }]),
})
execSync('powershell -NoProfile -Command Set-Clipboard -Value $null')
console.log(r.ok ? `Salvato ${nome}. Appunti svuotati.` : `ERRORE ${r.status}: niente salvato. Appunti svuotati.`)
process.exit(r.ok ? 0 : 1)
