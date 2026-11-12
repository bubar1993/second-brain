// Portafogli Crea Ceram del martedì (10.11.2026, ok di Giovanni). Niente AI: tutto a regole fisse.
// Ogni martedì Sara Pinton (Marazzi) manda a Giovanni i portafogli ordini in PDF; lui li gira a una lista fissa
// di clienti nella conversazione "Portafoglio Ordini Ragno". Questa funzione, quando la mail di Sara è arrivata,
// prepara la BOZZA in Gmail (stessi PDF, lista fissa) e la mette in Bozze: la manda Giovanni con due tocchi.
// NON invia niente da sola. L'invio automatico è un passo dopo, con un nuovo ok di Giovanni.
// Chi può: solo il giro programmato (x-copia-token). { prova: true } = dice cosa farebbe, senza creare niente;
// { data: 'YYYY-MM-DD' } con prova = fa finta che oggi sia quel giorno.
// Regole:
// - mittente Sara verificato (DKIM di marazzigroup.com, se no niente bozza), oggetto con "portafogl" e "crea",
//   PDF col nome XXSC_MRZ_ORD05_PO_CLIENTE_<numero>_<n>.PDF (di solito 2); gli altri allegati (il "file Polonia") restano fuori;
// - destinatari = lista fissa `liste_invio` 'portafogli_crea', mai presi da una mail arrivata. Se Giovanni nel SUO
//   ultimo invio ha cambiato i destinatari, la lista lo segue e la bozza lo dice;
// - se dopo la mail di Sara li ha già mandati lui da Gmail, niente bozza;
// - una sola bozza per settimana (indice unico su bozze.perche->>'settimana'); gli errori escono come 502, li vede il guardiano.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const UTENTE = 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'
const IO = 'giovannifabris@ceramex.ch'
const SARA = 'sara.pinton@marazzigroup.com'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const LISTA = 'portafogli_crea'
const NOME_PDF = /^XXSC_MRZ_ORD05_PO_CLIENTE_\d+_\d+\.PDF$/i
const MAX_PDF = 10 * 1024 * 1024
// Firma Ceramex dettata da Giovanni il 12.11.2026 ("sempre questa"): uguale in agente-ceramex.md e src/Riordino.jsx.
const FIRMA = 'Cordiali saluti\n___________________________________\n\nGiovanni Fabris\nSales Agent\n\nVia Cantonale 4\nCentro galleria 3\n6928 Manno\n\nTel. Privato: +41 79 576 70 03'

const risposta = (dati: unknown, status = 200) =>
  new Response(JSON.stringify(dati), { status, headers: { 'Content-Type': 'application/json' } })

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json()
}

async function accesso() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GMAIL_CLIENT_ID')!, client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GMAIL_REFRESH_TOKEN') || '', grant_type: 'refresh_token',
    }),
  })
  const t = await r.json().catch(() => ({}))
  if (!t.access_token) throw new Error(`Collegamento Gmail scaduto (${t.error || r.status})`)
  return t.access_token as string
}

async function gmail(token: string, percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${GMAIL}/${percorso}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.status === 204 ? {} : r.json()
}

type Parte = { partId?: string; filename?: string; mimeType?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Parte[]; headers?: { name: string; value: string }[] }
const intestazione = (p: Parte, nome: string) => p.headers?.find((h) => h.name.toLowerCase() === nome.toLowerCase())?.value || ''
const indirizzi = (s: string) => [...new Set((s.match(/[^\s<>",;]+@[^\s<>",;]+/g) || []).map((x) => x.toLowerCase()))]
const tutteLeParti = (p: Parte): Parte[] => [p, ...(p.parts || []).flatMap(tutteLeParti)]
const daBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
function aBase64(byte: Uint8Array) {
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin)
}
const righe76 = (s: string) => s.replace(/.{76}/g, '$&\r\n')
const testoDi = (p: Parte): string => {
  if (p.mimeType === 'text/plain' && p.body?.data) return new TextDecoder().decode(daBase64Url(p.body.data))
  for (const x of p.parts || []) { const t = testoDi(x); if (t) return t }
  return ''
}

// Giorno di Zurigo 'YYYY-MM-DD', giorno della settimana (1 = lunedì) e lunedì di quella settimana.
const oggiZurigo = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
const giornoDi = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
const lunediDi = (d: string) => new Date(new Date(`${d}T12:00:00Z`).getTime() - (giornoDi(d) - 1) * 86400e3).toISOString().slice(0, 10)

// La mail di Sara di quel giorno con i PDF dei portafogli (la più recente), o null.
async function mailDiSara(token: string, giorno: string) {
  const da = Math.floor(new Date(`${giorno}T00:00:00Z`).getTime() / 1000) - 2 * 3600 // mezzanotte di Zurigo, con margine
  const q = `from:${SARA} has:attachment after:${da} before:${da + 26 * 3600}`
  const { messages } = await gmail(token, `messages?maxResults=20&q=${encodeURIComponent(q)}`)
  for (const m of messages || []) {
    const msg = await gmail(token, `messages/${m.id}?format=full`)
    const p = msg.payload as Parte
    const oggetto = intestazione(p, 'Subject')
    if (!/portafogl/i.test(oggetto) || !/crea/i.test(oggetto)) continue
    if (indirizzi(intestazione(p, 'From'))[0] !== SARA) continue
    // Solo a Giovanni: le mail "per cliente" della domenica (lui in copia) non c'entrano.
    if (!indirizzi(intestazione(p, 'To')).includes(IO)) continue
    const pdf = tutteLeParti(p).filter((x) => x.filename && NOME_PDF.test(x.filename) && x.body?.attachmentId)
    if (!pdf.length) continue
    // Un PDF troppo grande non si toglie in silenzio: niente bozza, e l'errore si vede.
    const grande = pdf.find((x) => (x.body?.size || 0) > MAX_PDF)
    if (grande) throw new Error(`il PDF ${grande.filename} è troppo grande: giralo tu da Gmail`)
    const altri = tutteLeParti(p).filter((x) => x.filename && !NOME_PDF.test(x.filename) && !/^image\//.test(x.mimeType || '')).map((x) => x.filename as string)
    // Mittente vero: Gmail scrive qui se la firma di marazzigroup.com (DKIM) è valida.
    const auth = (p.headers || []).filter((h) => /^(arc-)?authentication-results$/i.test(h.name)).map((h) => h.value).join(' ')
    const verificata = /dkim=pass[^;]*header\.[id]=@?(?:[\w.-]+\.)?marazzigroup\.com(?=[\s;)]|$)/i.test(auth)
    // Il testo di Sara senza la sua firma: se scrive altro oltre al saluto, Giovanni lo vede nella bozza.
    const scritto = testoDi(p).split(/Mit freundlichen Gr/i)[0].replace(/\s+/g, ' ').trim().slice(0, 300)
    return { id: msg.id as string, il: Number(msg.internalDate), oggetto, pdf, altri, verificata, scritto }
  }
  return null
}

// L'ultimo invio vero di Giovanni (stesso oggetto, almeno 10 destinatari: non una risposta a uno solo).
async function ultimoInvio(token: string, oggetto: string) {
  const { messages } = await gmail(token, `messages?maxResults=15&q=${encodeURIComponent(`in:sent subject:"${oggetto}"`)}`)
  for (const m of messages || []) {
    const msg = await gmail(token, `messages/${m.id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`)
    const p = msg.payload as Parte
    // Stesso oggetto, anche se parte come risposta ("Re:", "R:", "AW:"); non gli inoltri ("Fwd: RE: …" a Sara).
    if (intestazione(p, 'Subject').trim().replace(/^((re|r|aw)\s*:\s*)+/i, '').toLowerCase() !== oggetto.toLowerCase()) continue
    const a = indirizzi(intestazione(p, 'To'))
    if (a.length < 10) continue
    return { il: Number(msg.internalDate), threadId: msg.threadId as string, messageId: intestazione(p, 'Message-ID'), references: intestazione(p, 'References'), a, cc: indirizzi(intestazione(p, 'Cc')) }
  }
  return null
}

const parolaMime = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${aBase64(new TextEncoder().encode(s))}?=`

// Pulizia: le bozze dei portafogli ancora "da approvare" che in Gmail non ci sono più (mandate o cancellate da lì),
// o vecchie di più di 7 giorni, si chiudono; le righe prenotate e mai finite (giro interrotto) si tolgono.
async function pulisci(token: string) {
  const aperte = await rest('bozze?select=id,gmail_draft_id,creata_il&stato=eq.proposta&perche->>tipo=eq.portafogli_crea') as Record<string, any>[]
  for (const b of aperte) {
    const eta = Date.now() - new Date(b.creata_il).getTime()
    if (!b.gmail_draft_id) {
      if (eta > 10 * 60e3) await rest(`bozze?id=eq.${b.id}&stato=eq.proposta&gmail_draft_id=is.null`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      continue
    }
    const r = await fetch(`${GMAIL}/drafts/${b.gmail_draft_id}?format=minimal`, { headers: { Authorization: `Bearer ${token}` } })
    const motivo = r.status === 404 ? 'Mandata o cancellata da Gmail' : eta > 7 * 86400e3 ? 'Mai mandata: sono passati 7 giorni' : null
    if (!motivo) continue
    const ora = new Date().toISOString()
    await rest(`bozze?id=eq.${b.id}&stato=eq.proposta`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ stato: 'annullata', annullata_il: ora, motivo_annullata: motivo, modificata_il: ora }) })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return risposta({ errore: 'Usa POST' }, 405)
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) return risposta({ errore: 'Non autorizzato' }, 401)
  const corpo = await req.json().catch(() => ({}))
  const prova = corpo.prova === true
  try {
    const giorno = prova && /^\d{4}-\d{2}-\d{2}$/.test(String(corpo.data)) ? String(corpo.data) : oggiZurigo()
    if (giornoDi(giorno) !== 2) return risposta({ ok: true, fatto: 'niente: non è martedì' })
    const settimana = lunediDi(giorno)
    const token = await accesso()
    if (!prova) await pulisci(token)
    const gia = await rest(`bozze?select=id&perche->>tipo=eq.portafogli_crea&perche->>settimana=eq.${settimana}&limit=1`) as unknown[]
    if (gia.length && !prova) return risposta({ ok: true, fatto: 'niente: bozza di questa settimana già fatta' })

    const [lista] = await rest(`liste_invio?chiave=eq.${LISTA}&select=oggetto,a,cc,aggiornata_il`) as Record<string, any>[]
    if (!lista?.a?.length) throw new Error('manca la lista dei destinatari')
    const sara = await mailDiSara(token, giorno)
    if (!sara) return risposta({ ok: true, fatto: 'niente: la mail di Sara non è ancora arrivata' })
    // I PDF vanno a tanti clienti: se non è certo che la mail venga da Marazzi, niente bozza (l'errore si vede).
    if (!sara.verificata && !prova) throw new Error('non riesco a verificare che la mail di Sara venga davvero da Marazzi: giralo tu da Gmail')

    const ultimo = await ultimoInvio(token, lista.oggetto)
    // Li ha già girati lui da Gmail dopo la mail di Sara: niente bozza.
    if (ultimo && ultimo.il > sara.il && !prova) return risposta({ ok: true, fatto: 'niente: li hai già mandati tu da Gmail' })
    let a: string[] = lista.a, cc: string[] = lista.cc || []
    const avvisi: string[] = []
    if (ultimo) {
      const prima = new Set([...ultimo.a, ...ultimo.cc]), ora = new Set([...a, ...cc])
      const nuovi = [...prima].filter((x) => !ora.has(x)), tolti = [...ora].filter((x) => !prima.has(x))
      if (nuovi.length || tolti.length) {
        const cosa = `${nuovi.length ? ` in più ${nuovi.join(', ')}` : ''}${nuovi.length && tolti.length ? ';' : ''}${tolti.length ? ` in meno ${tolti.join(', ')}` : ''}`
        // Giovanni ha cambiato i destinatari nel suo ultimo invio (fatto da lui, dopo l'ultima lista): la lista
        // lo segue da sola. La fonte è solo la SUA mail inviata, mai il testo di una mail arrivata.
        if (ultimo.il > new Date(lista.aggiornata_il).getTime()) {
          a = ultimo.a; cc = ultimo.cc
          if (!prova) await rest(`liste_invio?chiave=eq.${LISTA}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ a, cc, aggiornata_il: new Date().toISOString() }) })
          avvisi.push(`Lista aggiornata dal tuo ultimo invio:${cosa}.`)
        } else avvisi.push(`ATTENZIONE: destinatari diversi dal tuo ultimo invio:${cosa}.`)
      }
    } else avvisi.push('Non trovo il tuo ultimo invio: la mail parte in una conversazione nuova.')
    if (sara.pdf.length !== 2) avvisi.push(`ATTENZIONE: di solito i PDF sono 2, oggi ${sara.pdf.length}.`)
    if (sara.altri.length) avvisi.push(`Lasciati fuori: ${sara.altri.join(', ')}.`)
    if (sara.scritto) avvisi.push(`Sara scrive: ${sara.scritto}`)
    const nomi = sara.pdf.map((x) => x.filename as string)
    const motivo = [`Portafogli di oggi da Sara: ${nomi.length} PDF, ${a.length + cc.length} destinatari.`, ...avvisi].join(' ')

    // I PDF di Sara. Un PDF vero comincia con %PDF: se no, niente bozza.
    const allegati: string[] = []
    let peso = 0
    for (const x of sara.pdf) {
      const all = await gmail(token, `messages/${sara.id}/attachments/${x.body!.attachmentId}`)
      const byte = daBase64Url(all.data)
      if (new TextDecoder().decode(byte.subarray(0, 4)) !== '%PDF') throw new Error(`l'allegato ${x.filename} non è un PDF vero`)
      peso += byte.length
      const nome = String(x.filename).replace(/[^\w.\-]/g, '_')
      allegati.push([`Content-Type: application/pdf; name="${nome}"`, `Content-Disposition: attachment; filename="${nome}"`,
        'Content-Transfer-Encoding: base64', '', righe76(aBase64(byte))].join('\r\n'))
    }
    if (peso > 3 * 1024 * 1024) throw new Error('i PDF di oggi sono troppo grandi per la bozza automatica: girali tu da Gmail')

    // In risposta all'ultimo invio (stessa conversazione). Dopo 95 messaggi Gmail spezza le conversazioni: se ne apre una nuova.
    let threadId: string | undefined, inReplyTo = '', references = ''
    if (ultimo) {
      const t = await gmail(token, `threads/${ultimo.threadId}?format=minimal`)
      if ((t.messages || []).length < 95) {
        threadId = ultimo.threadId
        inReplyTo = ultimo.messageId
        references = `${ultimo.references} ${ultimo.messageId}`.trim()
      }
    }
    const confine = `sb_${crypto.randomUUID().replace(/-/g, '')}`
    const mail = [
      `From: Giovanni Fabris <${IO}>`,
      `To: ${a.join(', ')}`,
      ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
      `Subject: ${parolaMime(lista.oggetto)}`,
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${references}`] : []),
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${confine}"`,
      '',
      `--${confine}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      righe76(aBase64(new TextEncoder().encode(FIRMA.replace(/\n/g, '\r\n')))),
      ...allegati.map((x) => `--${confine}\r\n${x}`),
      `--${confine}--`,
      '',
    ].join('\r\n')
    const raw = aBase64(new TextEncoder().encode(mail)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    if (prova) return risposta({ ok: true, prova: true, giorno, settimana, gia_fatta: gia.length > 0, mail_sara: sara.id, oggetto_sara: sara.oggetto,
      verificata: sara.verificata, pdf: nomi, peso_pdf: peso, peso_mail: raw.length, destinatari: a.length + cc.length,
      ultimo_invio: ultimo ? new Date(ultimo.il).toISOString() : null, stessa_conversazione: !!threadId, motivo })

    // Prima si prenota la riga (indice unico: una sola per settimana, anche con due giri insieme), poi la bozza in Gmail.
    let riga: Record<string, any>
    try {
      [riga] = await rest('bozze', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
        utente_id: UTENTE, area: 'C', canale: 'gmail', stato: 'proposta', oggetto: lista.oggetto, testo: FIRMA, testo_agente: FIRMA,
        a, cc, da_nome: 'Portafogli Crea Ceram', gmail_message_id: sara.id, imparata: true,
        perche: { tipo: 'portafogli_crea', settimana, motivo, allegati: nomi, fonti: [`mail di Sara Pinton del ${giorno}`] },
      }) }) as Record<string, any>[]
    } catch (e) {
      if (/ 409 /.test(String((e as Error)?.message))) return risposta({ ok: true, fatto: 'niente: bozza di questa settimana già fatta' })
      throw e
    }
    try {
      const bozza = await gmail(token, 'drafts', { method: 'POST', body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) })
      await rest(`bozze?id=eq.${riga.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ gmail_draft_id: bozza.id, gmail_thread_id: bozza.message?.threadId || threadId || null }) })
    } catch (e) {
      // Bozza non riuscita: la prenotazione si toglie, il giro dopo riprova.
      await rest(`bozze?id=eq.${riga.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {})
      throw e
    }
    return risposta({ ok: true, fatto: 'bozza creata', pdf: nomi, destinatari: a.length + cc.length })
  } catch (e) {
    console.error('portafogli', e)
    return risposta({ errore: `Portafogli Crea Ceram: ${String((e as Error)?.message || e).slice(0, 280)}` }, 502)
  }
})