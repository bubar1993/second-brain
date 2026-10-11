// Copia schede, note, regole e mail viste dal gestionale Ceramex (solo lettura) al second brain.
// Gli id restano gli stessi: rilanciarlo aggiorna, non crea doppioni.
// Uso: node copia-ceramex.mjs [--migrazione]
import { readFileSync } from 'node:fs'

const REF = 'vgurncqvgulldolhetyr'
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const UA = { 'User-Agent': 'secondbrain-setup/1.0' }
const MGMT = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }

function fermati(msg) { console.log('ERRORE ' + msg); process.exit(1) }

// 1. Migrazione (solo se richiesta)
if (process.argv.includes('--migrazione')) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/migrations`, {
    method: 'POST', headers: { ...MGMT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ceramex_aziende', query: readFileSync('C:/Users/giova/Documents/secondbrain/supabase/migrations/20261011200000_ceramex_aziende.sql', 'utf8') }),
  })
  if (!r.ok) fermati('migrazione ' + r.status + ' ' + (await r.text()).slice(0, 400))
  console.log('Migrazione: ok')
}

// 2. Chiavi (mai stampate)
const envCeramex = readFileSync('C:/Users/giova/Documents/ceramex/reader/.env.example', 'utf8')
const chiaveC = envCeramex.match(/^SUPABASE_SERVICE_KEY=(\S+)/m)?.[1]
if (!chiaveC) fermati('chiave Ceramex non trovata')
const rk = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: MGMT })
const chiaveSB = (await rk.json()).find((k) => k.type === 'secret')?.api_key
if (!chiaveSB) fermati('chiave second brain non trovata')

// 3. Lettura dal gestionale Ceramex (solo GET)
async function leggiC(tabella) {
  const righe = []
  for (let da = 0; ; da += 1000) {
    const r = await fetch(`https://nouxqowregwnyqlrvqqo.supabase.co/rest/v1/${tabella}?select=*&order=${tabella === 'note_mail_viste' ? 'message_id' : 'id'}&offset=${da}&limit=1000`, {
      headers: { ...UA, apikey: chiaveC, Authorization: `Bearer ${chiaveC}` },
    })
    if (!r.ok) fermati(`lettura ${tabella} ${r.status} ${(await r.text()).slice(0, 300)}`)
    const pezzo = await r.json()
    righe.push(...pezzo)
    if (pezzo.length < 1000) return righe
  }
}
const [clienti, note, regole, viste] = await Promise.all(
  ['clienti', 'note_clienti', 'note_regole', 'note_mail_viste'].map(leggiC))
console.log(`Letti da Ceramex: ${clienti.length} schede, ${note.length} note, ${regole.length} regole, ${viste.length} mail viste`)

// 4. Scrittura nel second brain (upsert per id)
async function scrivi(tabella, righe, conflitto = 'id') {
  for (let i = 0; i < righe.length; i += 300) {
    const r = await fetch(`https://${REF}.supabase.co/rest/v1/${tabella}?on_conflict=${conflitto}`, {
      method: 'POST',
      headers: { ...UA, apikey: chiaveSB, Authorization: `Bearer ${chiaveSB}`, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(righe.slice(i, i + 300)),
    })
    if (!r.ok) fermati(`scrittura ${tabella} ${r.status} ${(await r.text()).slice(0, 400)}`)
  }
}

await scrivi('aziende', clienti.map((c) => ({
  id: c.id, utente_id: UTENTE, area: 'C', nome: c.nome, ragione_sociale: c.azienda,
  email: c.email, domini: c.domini, contatti: c.persone, gruppo_id: c.gruppo_id, unito_in: c.unito_in,
  creata_il: c.creato_il, modificata_il: c.aggiornato_il,
})))

await scrivi('note', note.map((n) => ({
  id: n.id, utente_id: UTENTE, area: 'C', testo: n.testo, fonte: n.fonte === 'mano' ? 'scritta' : n.fonte,
  azienda_id: n.cliente_id, mandante: n.mandante, sezione: n.sezione, data: n.data, contatto: n.persona,
  risolto_il: n.risolto_il, scartata_il: n.scartata_il, thread_id: n.thread_id, message_id: n.message_id,
  testo_agente: n.testo_agente, sezione_agente: n.sezione_agente, imparata: n.imparata,
  creata_il: n.creato_il, modificata_il: n.aggiornato_il,
})))

await scrivi('regole_agenti', regole.map((g) => ({
  id: g.id, utente_id: UTENTE, area: 'C', agente: 'note', tipo: g.tipo, regola: g.regola, esempi: g.esempi,
  creata_il: g.creato_il, modificata_il: g.aggiornato_il,
})))

await scrivi('mail_viste', viste.map((v) => ({
  message_id: v.message_id, utente_id: UTENTE, area: 'C', thread_id: v.thread_id,
  esito: v.esito, motivo: v.motivo, vista_il: v.visto_il,
})), 'message_id')

// 5. Controllo
const q = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: { ...MGMT, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `select
    (select count(*) from aziende where area='C') aziende,
    (select count(*) from note where azienda_id is not null) note_clienti,
    (select count(*) from regole_agenti) regole,
    (select count(*) from mail_viste) viste` }),
})
console.log('Nel second brain:', JSON.stringify(await q.json()))
