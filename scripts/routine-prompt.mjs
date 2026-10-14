// Aiuto per cambiare il prompt di una routine claude.ai senza errori di copiatura (usato il 14.10.2026).
// Il prompt contiene il token dell'agente: i file che crea vanno SOLO nella cartella temporanea (scratchpad), mai nel progetto.
//
// 1. RemoteTrigger get → la risposta lunga viene salvata in un file (tool-results/…txt).
// 2. node scripts/routine-prompt.mjs estrai <risposta.txt> <prompt.txt>
//      scrive il prompt attuale in <prompt.txt> e stampa uuid, modello, ambiente e connettori.
// 3. Modifica <prompt.txt> (Edit), poi leggilo (Read) e passa il testo intero a RemoteTrigger update
//      (body: job_config.ccr = environment_id, session_context come prima, events[0].data con lo stesso uuid).
// 4. node scripts/routine-prompt.mjs confronta <risposta dell'update.txt> <prompt.txt>
//      dice IDENTICO, oppure il primo punto in cui il prompt salvato è diverso.
import { readFileSync, writeFileSync } from 'node:fs'

const [, , azione, da, file] = process.argv
const grezzo = readFileSync(da, 'utf8')
const t = JSON.parse(grezzo.slice(grezzo.indexOf('{'))).trigger
const ccr = t.job_config.ccr
const salvato = ccr.events[0].data.message.content

if (azione === 'estrai') {
  writeFileSync(file, salvato)
  console.log(t.name, '| uuid', ccr.events[0].data.uuid, '| ambiente', ccr.environment_id)
  console.log('session_context', JSON.stringify(ccr.session_context))
  console.log('connettori', t.mcp_connections.map((m) => m.name).join(', '), '| caratteri', salvato.length)
} else if (azione === 'confronta') {
  const voluto = readFileSync(file, 'utf8')
  if (salvato === voluto) console.log('IDENTICO', t.name, salvato.length, '| connettori:', t.mcp_connections.map((m) => m.name).join(', '))
  else {
    let i = 0
    while (salvato[i] === voluto[i]) i++
    console.log('DIVERSO al carattere', i, '\nsalvato:', JSON.stringify(salvato.slice(i - 40, i + 60)), '\nvoluto: ', JSON.stringify(voluto.slice(i - 40, i + 60)))
  }
} else {
  console.log('Uso: node scripts/routine-prompt.mjs estrai|confronta <risposta RemoteTrigger.txt> <prompt.txt>')
}
