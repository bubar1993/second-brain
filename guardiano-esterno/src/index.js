// Guardiano esterno (passo 2). Gira ogni 5 minuti su Cloudflare, fuori dal Brain.
// Controlla: l'app Brain si apre; il database e le funzioni del Brain rispondono (battito della funzione
// "guardiano"); il guardiano del Brain ha fatto un controllo negli ultimi 40 minuti; le notifiche sono partite
// negli ultimi 20 minuti. Un problema visto in 2 controlli di fila → WhatsApp "Guasto"; quando sparisce →
// "Risolto". Lo stato (cosa è aperto) sta nel KV "STATO". Non ripara niente.
const APP_BRAIN = 'https://second-brain.aged-king-4bbd.workers.dev/'
const BATTITO = 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/guardiano'
const VOLTE_PRIMA_DI_AVVISARE = 2

async function conRiprova(fn) {
  try { return await fn() } catch {
    await new Promise((r) => setTimeout(r, 4000))
    return await fn()
  }
}

async function problemi(env) {
  const out = []
  try {
    await conRiprova(async () => {
      const r = await fetch(APP_BRAIN, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'guardiano-esterno' } })
      await r.body?.cancel()
      if (r.status >= 400) throw new Error(`risponde ${r.status}`)
    })
  } catch (e) {
    out.push({ chiave: 'app-brain', titolo: 'L\'app Brain non si apre', dettaglio: String(e.message || e) })
  }

  let b
  try {
    b = await conRiprova(async () => {
      const r = await fetch(BATTITO, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'x-esterno-token': env.ESTERNO_TOKEN, 'Content-Type': 'application/json' }, body: '{}' })
      if (!r.ok) throw new Error(`risponde ${r.status}`)
      return await r.json()
    })
  } catch (e) {
    out.push({ chiave: 'brain', titolo: 'Il Brain (database e funzioni) non risponde', dettaglio: `${String(e.message || e)}. Finché non torna, niente notifiche sul telefono.` })
    return out
  }
  const adesso = Date.parse(b.adesso)
  const ora = (iso) => (iso ? new Date(iso).toLocaleString('it-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'mai')
  if (!b.guardiano || adesso - Date.parse(b.guardiano) > 40 * 60000) {
    out.push({ chiave: 'guardiano', titolo: 'Il guardiano del Brain non controlla più', dettaglio: `Ultimo controllo: ${ora(b.guardiano)}` })
  }
  if (!b.notifiche || adesso - Date.parse(b.notifiche) > 20 * 60000) {
    out.push({ chiave: 'notifiche', titolo: 'Le notifiche del Brain non partono', dettaglio: `Ultimo giro: ${ora(b.notifiche)}. Promemoria e appuntamenti non suonano.` })
  }
  return out
}

async function whatsapp(env, titolo, corpo) {
  const pulisci = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 500) || '-'
  const r = await fetch(`https://graph.facebook.com/v26.0/${env.WA_AVVISI_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WA_AVVISI_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: env.WA_AVVISI_A, type: 'template',
      template: { name: 'avviso_guasto', language: { code: 'it' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: pulisci(titolo) }, { type: 'text', text: pulisci(corpo) }] }] },
    }),
  })
  if (!r.ok) throw new Error(`WhatsApp ${r.status} ${(await r.text()).slice(0, 200)}`)
}

async function giro(env) {
  if (!env.ESTERNO_TOKEN || !env.WA_AVVISI_TOKEN) return console.log('mancano i segreti: niente controllo')
  // stato: { chiave: { titolo, volte, avvisato } }
  const stato = JSON.parse((await env.STATO.get('aperti')) || '{}')
  const prima = JSON.stringify(stato)
  const trovati = await problemi(env)

  for (const p of trovati) {
    const s = stato[p.chiave] || { titolo: p.titolo, volte: 0, avvisato: false }
    s.volte = Math.min(s.volte + 1, VOLTE_PRIMA_DI_AVVISARE)
    s.titolo = p.titolo
    if (!s.avvisato && s.volte >= VOLTE_PRIMA_DI_AVVISARE) {
      try {
        await whatsapp(env, `Guasto: ${p.titolo}`, p.dettaglio)
        s.avvisato = true
      } catch (e) {
        console.log('avviso non mandato', String(e.message || e))
      }
    }
    stato[p.chiave] = s
  }
  for (const [chiave, s] of Object.entries(stato)) {
    if (trovati.some((p) => p.chiave === chiave)) continue
    if (s.avvisato) {
      try { await whatsapp(env, `Risolto: ${s.titolo}`, 'Il guardiano esterno lo vede di nuovo a posto.') } catch (e) {
        console.log('risolto non mandato', String(e.message || e))
        continue // riprova al prossimo giro
      }
    }
    delete stato[chiave]
  }
  // KV: si scrive solo quando cambia qualcosa (quota gratuita di scritture).
  if (JSON.stringify(stato) !== prima) await env.STATO.put('aperti', JSON.stringify(stato))
  console.log('giro', JSON.stringify({ problemi: trovati.map((p) => p.chiave) }))
}

export default {
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(giro(env))
  },
}
