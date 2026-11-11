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
// Solo controllo (11.11.2026): node scripts/routine-prompt.mjs esamina <risposta.txt> <agenti/agente-x.md> [parola1,parola2]
//      stampa attiva/modello/cron/connettori, le righe diverse dal file .md e le righe con le parole cercate,
//      con i token mascherati (così si legge senza far entrare il prompt intero nella chat).
import { readFileSync, writeFileSync } from 'node:fs'

const [, , azione, da, file] = process.argv
const grezzo = readFileSync(da, 'utf8')
// La risposta di update finisce con righe "→ Scheduled…" dopo il JSON: si tolgono.
const t = JSON.parse(grezzo.slice(grezzo.indexOf('{')).split(/\r?\n\s*→/)[0]).trigger
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
} else if (azione === 'esamina') {
  const parole = process.argv[5] ?? ''
  const maschera = (s) => s.replace(/[A-Za-z0-9_-]{24,}/g, '<TOKEN>').replace(/sk-ant-[^\s"']+/g, '<TOKEN>')
  const righe = (s) => maschera(s).split(/\r?\n/).map((r) => r.trimEnd()).filter((r) => r.trim() !== '')
  const corta = (r) => (r.length > 220 ? r.slice(0, 220) + '…' : r)
  const P = righe(salvato), M = file ? righe(readFileSync(file, 'utf8')) : []
  const inP = new Set(P), inM = new Set(M)
  console.log(`# ${t.name} | attiva ${t.enabled} | modello ${ccr.session_context.model} | cron ${t.cron_expression} | connettori: ${t.mcp_connections.map((m) => m.name).join(', ') || '-'} | aggiornata ${t.updated_at}`)
  if (file) {
    const soloP = P.filter((r) => !inM.has(r)), soloM = M.filter((r) => !inP.has(r))
    console.log(`righe solo nella routine: ${soloP.length} | solo nel file: ${soloM.length}`)
    soloP.slice(0, 12).forEach((r) => console.log('  R+ ' + corta(r)))
    soloM.slice(0, 12).forEach((r) => console.log('  F+ ' + corta(r)))
  }
  for (const p of parole.split(',').filter(Boolean)) {
    const re = new RegExp(p, 'i'), hit = P.filter((r) => re.test(r))
    console.log(`"${p}": ${hit.length} righe` + (hit.length ? ' → ' + hit.slice(0, 3).map((r) => corta(r.slice(Math.max(0, r.search(re) - 60)))).join(' || ') : ''))
  }
} else {
  console.log('Uso: node scripts/routine-prompt.mjs estrai|confronta|esamina <risposta RemoteTrigger.txt> <prompt.txt | agente.md> [parole]')
}
