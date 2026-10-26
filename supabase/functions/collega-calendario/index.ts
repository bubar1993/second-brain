// Permesso di SOLA LETTURA sul Google Calendar di Giovanni per il portinaio (26.10.2026, ok di Giovanni).
// Google non fa più vedere né scaricare la chiave (client secret) del client "Second Brain Gmail": lo scambio del
// codice di consenso lo fa questa funzione, che la chiave ce l'ha già (GMAIL_CLIENT_SECRET). Nessuna chiave nuova.
// La chiama solo lo script del PC `node scripts/collega-calendario.mjs`, con il token personale di Supabase di
// Giovanni (x-supabase-pat): la funzione lo controlla chiedendo il progetto all'API di Supabase e lo usa solo per
// salvare il segreto CALENDARIO_REFRESH_TOKEN. Non restituisce mai token né chiavi e non scrive niente nei log.
// Resta pubblicata solo per i minuti del collegamento, poi si toglie (`functions delete collega-calendario`):
// riceve un token che vede tutte le organizzazioni. Il codice resta qui per rifarlo.
// { azione: 'inizio' } → client_id (pubblico, sta già negli indirizzi di Google).
// { azione: 'fine', code, redirect_uri, code_verifier } → scambio (PKCE), prova del calendario, segreto salvato.

const REF = 'vgurncqvgulldolhetyr'
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const CALENDARIO = 'giovannifabris@ceramex.ch'
const risposta = (dati: unknown, status = 200) => Response.json(dati, { status })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return risposta({ ok: false, errore: 'Solo POST' }, 405)
  const pat = req.headers.get('x-supabase-pat') || ''
  if (!pat) return risposta({ ok: false, errore: 'Non autorizzato' }, 401)
  const prova = await fetch(`https://api.supabase.com/v1/projects/${REF}`, { headers: { Authorization: `Bearer ${pat}` } })
  if (!prova.ok) return risposta({ ok: false, errore: 'Non autorizzato' }, 401)

  const { azione, code, redirect_uri, code_verifier } = await req.json().catch(() => ({}))
  const client_id = Deno.env.get('GMAIL_CLIENT_ID')!
  if (azione === 'inizio') return risposta({ ok: true, client_id, scope: SCOPE })
  if (azione !== 'fine') return risposta({ ok: false, errore: 'Azione sconosciuta' }, 400)
  if (typeof code !== 'string' || typeof code_verifier !== 'string'
    || !/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(String(redirect_uri))) {
    return risposta({ ok: false, errore: 'Dati mancanti' }, 400)
  }

  const tok = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id, client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!, redirect_uri,
      code_verifier, grant_type: 'authorization_code' }),
  })).json()
  if (!tok.refresh_token) return risposta({ ok: false, errore: `Google: ${tok.error || 'nessun refresh token'}` }, 400)
  // Solo il permesso di lettura del calendario, nient'altro.
  const permessi = String(tok.scope || '').split(' ').filter(Boolean)
  if (permessi.length !== 1 || permessi[0] !== SCOPE) return risposta({ ok: false, errore: `Permessi inattesi: ${permessi.join(', ')}` }, 400)

  // Il calendario principale dell'account che ha dato il consenso deve essere proprio quello di Giovanni
  // (login_hint suggerisce l'account ma non lo impone).
  const c = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary?fields=id',
    { headers: { Authorization: `Bearer ${tok.access_token}` } })
  if (!c.ok) {
    const t = await c.text()
    const link = t.match(/https:\/\/console\.developers\.google\.com\/[^\s"]+/)?.[0]
    return risposta({ ok: false, errore: `Calendario non raggiungibile (${c.status})`, link: link || null }, 400)
  }
  if ((await c.json()).id !== CALENDARIO) return risposta({ ok: false, errore: `Account sbagliato: serve ${CALENDARIO}` }, 400)

  const s = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'CALENDARIO_REFRESH_TOKEN', value: tok.refresh_token }]),
  })
  return risposta({ ok: s.ok, calendario: true, salvato: s.ok, errore: s.ok ? null : `Supabase ${s.status}` }, s.ok ? 200 : 500)
})
