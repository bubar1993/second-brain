// WhatsApp (fase 7): collega il NUMERO DI PROVA di Meta, per l'analisi dell'app (video e chiamate di prova).
// Giovanni, nella pagina Meta "Passaggio 1. Prova", genera il token temporaneo e lo copia negli appunti.
// Questo script lo legge dagli appunti (senza stamparlo), li svuota e lo passa alla funzione whatsapp-collega.
// Il numero vero si collega dopo l'approvazione con l'iscrizione integrata: sovrascrive questa prova.
// Uso: node scripts/whatsapp-prova.mjs <waba_id> <phone_number_id>   (serve la variabile WA_COLLEGA_TOKEN)
import { execSync } from 'node:child_process'

const [waba_id, phone_number_id] = process.argv.slice(2)
if (!/^\d+$/.test(waba_id || '') || !/^\d+$/.test(phone_number_id || '')) {
  console.log('Uso: node scripts/whatsapp-prova.mjs <waba_id> <phone_number_id>')
  process.exit(1)
}
const collega = process.env.WA_COLLEGA_TOKEN ||
  execSync(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('WA_COLLEGA_TOKEN','User')"`, { encoding: 'utf8' }).trim()
if (!collega) { console.log('ERRORE: manca WA_COLLEGA_TOKEN'); process.exit(1) }

const token = execSync('powershell -NoProfile -Command Get-Clipboard', { encoding: 'utf8' }).trim()
if (!/^EAA[A-Za-z0-9]+$/.test(token)) {
  console.log('Negli appunti non c\'è il token di Meta (inizia con EAA). Copialo e rilancia.')
  process.exit(1)
}
execSync('powershell -NoProfile -Command Set-Clipboard -Value $null')
console.log('Token trovato negli appunti (poi svuotati).')

const r = await fetch('https://vgurncqvgulldolhetyr.supabase.co/functions/v1/whatsapp-collega', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-collega-token': collega },
  body: JSON.stringify({ token_prova: token, waba_id, phone_number_id }),
})
const j = await r.json().catch(() => ({}))
console.log(r.ok ? `Numero di prova collegato: ${j.fatto?.numero?.display_phone_number || '?'} (${j.fatto?.numero?.verified_name || ''})` : `ERRORE: ${j.errore || r.status}`)
