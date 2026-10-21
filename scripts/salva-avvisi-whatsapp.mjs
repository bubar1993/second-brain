// Avvisi del guardiano su WhatsApp (21.10.2026, ok di Giovanni), dal numero di prova di Meta.
// Giovanni crea su Meta la chiave permanente di un utente di sistema (permessi whatsapp_business_messaging e
// whatsapp_business_management) e la copia negli appunti. Questo script, senza mai stamparla:
//   1. la prova (legge il numero di prova);
//   2. crea il modello "avviso_guasto" se non c'è (Meta lo deve approvare, di solito pochi minuti);
//   3. crea una chiave nuova ESTERNO_TOKEN (solo per il battito del guardiano esterno);
//   4. salva WA_AVVISI_TOKEN, WA_AVVISI_PHONE_ID, WA_AVVISI_A ed ESTERNO_TOKEN nei segreti del Brain e del
//      Worker guardiano-esterno;
//   5. svuota gli appunti.
// Uso: node scripts/salva-avvisi-whatsapp.mjs <numero di Giovanni, es. +41 79 123 45 67>   (serve SUPABASE_ACCESS_TOKEN)
//      node scripts/salva-avvisi-whatsapp.mjs --solo-modello   (crea solo il modello, non salva niente)
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const REF = 'vgurncqvgulldolhetyr'
const WABA = '1132628449338035'        // account WhatsApp del numero di prova di Meta
const PHONE_ID = '1294186367119756'    // numero di prova +1 555 645 6202
const GRAPH = 'https://graph.facebook.com/v26.0'
const MODELLO = {
  name: 'avviso_guasto', language: 'it', category: 'UTILITY',
  components: [{
    type: 'BODY',
    // Testo approvato (21.10.2026, creato a mano in WhatsApp Manager: la chiave di AvvisiBrain non vede l'account
    // del numero di prova). "Avviso dal guardiano…" Meta lo voleva come Marketing: così passa come Utility.
    text: 'Aggiornamento di stato del tuo servizio Second Brain: {{1}}. Dettagli: {{2}}. Ti avviseremo di nuovo quando il servizio torna regolare.',
    example: { body_text: [['Guasto: L\'app Ceramex non si apre', 'risponde 503 dalle 14:05']] },
  }],
}

// --solo-modello: usa la chiave negli appunti (anche quella temporanea di 24 h della pagina "Prova" di Meta)
// solo per creare il modello, senza salvarla.
const SOLO_MODELLO = process.argv.includes('--solo-modello')
const numero = (process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || '').replace(/[^\d]/g, '')
if (!SOLO_MODELLO && numero.length < 9) { console.log('Uso: node scripts/salva-avvisi-whatsapp.mjs <numero di Giovanni> | --solo-modello'); process.exit(1) }
const tokenApi = process.env.SUPABASE_ACCESS_TOKEN
  || execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'SUPABASE_ACCESS_TOKEN\',\'User\')"', { encoding: 'utf8' }).trim()
if (!tokenApi) { console.log('ERRORE: manca SUPABASE_ACCESS_TOKEN'); process.exit(1) }

const svuota = () => execSync('powershell -NoProfile -Command Set-Clipboard -Value $null')
const chiave = execSync('powershell -NoProfile -Command Get-Clipboard', { encoding: 'utf8' }).trim()
if (!/^EAA[A-Za-z0-9]{50,}$/.test(chiave)) {
  console.log('Negli appunti non c\'è una chiave di Meta (deve cominciare con EAA). Niente salvato.')
  process.exit(1)
}
const meta = (percorso, init = {}) => fetch(`${GRAPH}/${percorso}`, {
  ...init, headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
})

try {
  // 1. Prova
  const p = await meta(`${PHONE_ID}?fields=display_phone_number,verified_name`)
  if (!p.ok) throw new Error(`la chiave non legge il numero di prova (${p.status}): ${(await p.text()).slice(0, 200)}`)
  const info = await p.json()
  console.log(`1. Chiave ok: legge il numero ${info.display_phone_number} (${info.verified_name}).`)

  // 2. Modello (se non riesce, la chiave si salva lo stesso: il modello si può creare a parte con --solo-modello)
  try {
    const m = await meta(`${WABA}/message_templates?name=${MODELLO.name}&fields=name,status,language`)
    const esistenti = m.ok ? (await m.json()).data || [] : []
    const gia = esistenti.find((x) => x.language === 'it')
    if (gia) {
      console.log(`2. Modello ${MODELLO.name} c'è già: stato ${gia.status}.`)
    } else {
      const c = await meta(`${WABA}/message_templates`, { method: 'POST', body: JSON.stringify(MODELLO) })
      const t = await c.json()
      if (!c.ok) throw new Error(`(${c.status}): ${(t.error?.message || JSON.stringify(t)).slice(0, 200)}`)
      console.log(`2. Modello ${MODELLO.name} creato: stato ${t.status} (Meta lo deve approvare).`)
    }
  } catch (e) {
    console.log(`2. Modello NON creato ${e.message}`)
  }
  // 3-4. Segreti
  if (!SOLO_MODELLO) {
    const esterno = randomBytes(32).toString('base64url')
    const segreti = { WA_AVVISI_TOKEN: chiave, WA_AVVISI_PHONE_ID: PHONE_ID, WA_AVVISI_A: numero, ESTERNO_TOKEN: esterno }
    const s = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenApi}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.entries(segreti).map(([name, value]) => ({ name, value }))),
    })
    if (!s.ok) throw new Error(`segreti del Brain non salvati (${s.status})`)
    console.log('3. Segreti salvati nel Brain.')
    for (const [nome, valore] of Object.entries(segreti)) {
      execSync(`npx wrangler secret put ${nome} --config guardiano-esterno/wrangler.jsonc`, { input: valore, stdio: ['pipe', 'ignore', 'ignore'] })
    }
    console.log('4. Segreti salvati nel guardiano esterno (Cloudflare).')
  }
} catch (e) {
  console.log(`ERRORE: ${e.message}`)
  process.exitCode = 1
} finally {
  svuota()
  console.log('Appunti svuotati.')
}
