// Portinaio (23.10.2026, ok di Giovanni, fase 1). La chiama pg_cron ogni 10 minuti, giorno e notte.
// Al posto dei giri a orario fisso: guarda nel database (portinaio_lavoro, senza AI) se c'è lavoro NUOVO per lo
// smistatore o per l'agente G&C e solo allora sveglia la routine con il suo trigger API (come agente-subito).
// Regole (vedi docs/agenti-routine.md):
// - solo dalle 6 alle 23 di Zurigo; mai nei 20 minuti prima e dopo un giro fisso; mai se l'agente è partito
//   negli ultimi 20 minuti (portinaio, "Fallo adesso", sveglia dello smistatore);
// - tetto al giorno (G&C 30, smistatore 20): raggiunto, al massimo una sveglia all'ora e il guardiano avvisa;
// - dopo una sveglia l'agente deve scrivere lavori_registro entro 25 minuti: se no il portinaio non lo sveglia
//   più (errore nella tabella portinaio, lo vede il guardiano) finché non compare un giro nel registro.
// Il messaggio di avvio è sempre lo stesso testo fisso: niente dati del database (mail di estranei) dentro.
// Conosce solo questi due agenti. Con { "prova": true } dice chi sveglierebbe, senza svegliare né scrivere.
// Risponde sempre 200 (anche se una sveglia non parte: l'errore va nella tabella portinaio, ultimo_errore, e si
// riprova al controllo dopo; "errore" invece blocca l'agente ed è solo per il registro mancante).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')

const AVVIO = 'PORTINAIO-GIRO-COMPLETO: giro avviato dal portinaio perché c\'è lavoro nuovo. Fai il giro completo, come un giro a orario: RICHIESTE DI GIOVANNI, poi tutto il giro normale, e alla FINE la riga in lavori_registro.'

type Agente = {
  routine: string, token: string, tetto: number, fissi: [number, number][],
  motivi: string[], ritardati: string[], nomi: Record<string, string>,
}
const AGENTI: Record<string, Agente> = {
  gc: {
    routine: 'trig_0167WFkRzohRBwGMJKA5PQCi', token: 'ROUTINE_TOKEN_GC', tetto: 30, fissi: [[7, 0], [18, 0]],
    motivi: ['mail', 'parcheggio', 'note_cambiate', 'bozze', 'risposte', 'richieste'],
    // ritardati: contano solo se l'ultima partenza è di più di un'ora fa (riprova, non ogni 10 minuti)
    ritardati: ['mail_ferme'],
    nomi: { mail: 'mail nuove', parcheggio: 'note nel parcheggio', note_cambiate: 'note cambiate da imparare',
      bozze: 'bozze da imparare', risposte: 'risposte di Giovanni', richieste: 'richieste', mail_ferme: 'mail ancora da vedere' },
  },
  smistatore: {
    routine: 'trig_01EmGQxMLKmQgRjYHJw77p9L', token: 'ROUTINE_TOKEN_SMISTATORE', tetto: 20, fissi: [[7, 10]],
    motivi: ['richieste', 'domande', 'risposte', 'non_fatte', 'seguiti'],
    ritardati: ['seguiti_in_attesa'],
    nomi: { richieste: 'richieste', domande: 'domande nuove', risposte: 'risposte di Giovanni', non_fatte: 'richieste non fatte',
      seguiti: 'seguiti da mandare', seguiti_in_attesa: 'seguiti in attesa' },
  },
}
const PAUSA = 20 * 60000
const REGISTRO_ENTRO = 25 * 60000

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}
const aggiorna = (agente: string, campi: Record<string, unknown>) =>
  rest(`portinaio?agente=eq.${agente}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(campi) })

const formato = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', year: 'numeric', day: '2-digit', month: '2-digit', hourCycle: 'h23',
})
const zurigo = (ms: number) => {
  const p = Object.fromEntries(formato.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { minuti: Number(p.hour) * 60 + Number(p.minute), giorno: `${p.year}-${p.month}-${p.day}` }
}
const ms = (iso?: string | null) => (iso ? Date.parse(iso) : 0)

async function controlla(codice: string, a: Agente, adesso: number, prova: boolean) {
  const [stato] = await rest(`portinaio?agente=eq.${codice}&select=*`)
  const lavoro = await rest('rpc/portinaio_lavoro', { method: 'POST', body: JSON.stringify({ p_agente: codice }) })
  const z = zurigo(adesso)
  const partenza = ms(lavoro.partenza)
  const registro = ms(lavoro.registro)
  const fuori = (motivo: string) => ({ agente: codice, sveglia: false, motivo, lavoro })

  // Dopo una sveglia serve una riga nel registro. Se c'è, l'errore (se c'era) si chiude.
  const sveglia = ms(stato.ultima_sveglia)
  if (sveglia && registro > sveglia && stato.errore) {
    if (!prova) await aggiorna(codice, { errore: null, errore_il: null })
    stato.errore = null
  } else if (sveglia && registro <= sveglia && adesso - sveglia > REGISTRO_ENTRO && !stato.errore) {
    const errore = 'Svegliato ma non ha scritto il suo giro nel registro: il portinaio non lo sveglia più finché non compare un giro.'
    if (!prova) await aggiorna(codice, { errore, errore_il: new Date(adesso).toISOString() })
    stato.errore = errore
  }
  if (stato.errore) return fuori('in errore')

  if (z.minuti < 6 * 60 || z.minuti >= 23 * 60) return fuori('notte')
  if (a.fissi.some(([h, m]) => Math.abs(z.minuti - (h * 60 + m)) <= 20)) return fuori('vicino a un giro fisso')
  if (adesso - partenza < PAUSA) return fuori('partito da poco')

  const lontano = adesso - partenza > 60 * 60000
  const trovati = [...a.motivi, ...(lontano ? a.ritardati : [])].filter((m) => Number(lavoro[m]) > 0)
  if (!trovati.length) return fuori('niente di nuovo')

  const oggi = stato.giorno === z.giorno ? stato.sveglie_oggi : 0
  const tetto = oggi >= a.tetto
  if (tetto && !lontano) return fuori('tetto raggiunto: una sveglia all\'ora')
  const motivo = trovati.map((m) => `${lavoro[m]} ${a.nomi[m]}`).join(', ')
  if (prova) return { agente: codice, sveglia: true, motivo, lavoro }

  const campi: Record<string, unknown> = { ultima_sveglia: new Date(adesso).toISOString(), motivo, giorno: z.giorno, sveglie_oggi: oggi + 1 }
  if (tetto) campi.tetto_il = new Date(adesso).toISOString()
  const token = Deno.env.get(a.token)
  try {
    if (!token) throw new Error(`manca il segreto ${a.token}`)
    const f = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${a.routine}/fire`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: AVVIO }),
    })
    const dati = await f.json().catch(() => ({}))
    if (!f.ok) throw new Error(dati?.error?.message || `claude.ai ${f.status}`)
  } catch (e) {
    // Non blocca: riprova al controllo dopo; il guardiano avvisa se l'errore resta.
    const errore = `La sveglia non è partita: ${String((e as Error)?.message || e).slice(0, 250)}`
    await aggiorna(codice, { ultimo_errore: errore, ultimo_errore_il: new Date(adesso).toISOString() })
    return { agente: codice, sveglia: false, motivo: errore, lavoro }
  }
  await aggiorna(codice, { ...campi, ultimo_errore: null, ultimo_errore_il: null })
  // Freno in comune con agente-subito (tabella sveglie).
  await rest('sveglie?on_conflict=agente', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ agente: codice, ultima: new Date(adesso).toISOString() }) })
  return { agente: codice, sveglia: true, motivo, lavoro }
}

Deno.serve(async (req) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) return new Response('Non autorizzato', { status: 401 })
  const { prova } = await req.json().catch(() => ({}))
  const adesso = Date.now()
  const esiti = []
  for (const [codice, a] of Object.entries(AGENTI)) {
    try {
      esiti.push(await controlla(codice, a, adesso, !!prova))
      if (!prova) await aggiorna(codice, { ultimo_controllo: new Date(adesso).toISOString() })
    } catch (e) {
      // ultimo_controllo resta vecchio: se dura, il guardiano vede il portinaio fermo.
      const errore = `Il portinaio non riesce a controllare: ${String((e as Error)?.message || e).slice(0, 250)}`
      esiti.push({ agente: codice, sveglia: false, motivo: errore })
      if (!prova) await aggiorna(codice, { ultimo_errore: errore, ultimo_errore_il: new Date(adesso).toISOString() }).catch(() => {})
    }
  }
  return Response.json({ ok: true, prova: !!prova, esiti })
})
