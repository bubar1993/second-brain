// Notifiche sul telefono (13.10.2026, scelte di Giovanni): ogni 5 minuti (pg_cron) guarda cosa c'è da avvisare
// e lo manda ai telefoni iscritti (Web Push, gratis, niente servizi esterni a pagamento):
// - appuntamenti di lavoro e privati 1 ora prima (non i giorni di scuola chiusa, non quelli "tutto il giorno");
// - promemoria quando arriva l'ora (dal 14.10.2026 tutti, non solo gli urgenti);
// - risposte del Capo e cose che il Capo chiede di confermare;
// - guasti trovati dal guardiano (all'apertura e quando sono risolti).
// Ogni cosa si manda una volta sola (notifiche_inviate); se un appuntamento o promemoria viene spostato, si riavvisa.
// Niente notifiche di prova verso Giovanni.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const COPIA_TOKEN = Deno.env.get('COPIA_TOKEN')
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:giovannifabris@ceramex.ch'
const PRIMA_MIN = 60 // avviso degli appuntamenti: 1 ora prima

const sbHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
async function rest(percorso: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${percorso}`, { ...init, headers: { ...sbHeaders, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${percorso.split('?')[0]} ${r.status} ${(await r.text()).slice(0, 300)}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

// ---------- Web Push (RFC 8291 aes128gcm + VAPID RFC 8292), solo WebCrypto ----------
const enc = new TextEncoder()
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const deb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
const unisci = (...parti: Uint8Array[]) => {
  const out = new Uint8Array(parti.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parti) { out.set(p, i); i += p.length }
  return out
}

let chiaveVapid: CryptoKey | null = null
async function firmaVapid(aud: string) {
  if (!chiaveVapid) {
    const pub = deb64u(VAPID_PUBLIC)
    chiaveVapid = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  }
  const testa = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const corpo = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })))
  const firma = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chiaveVapid, enc.encode(`${testa}.${corpo}`)))
  return `vapid t=${testa}.${corpo}.${b64u(firma)}, k=${VAPID_PUBLIC}`
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, byte: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, byte * 8))
}

async function cifra(p256dh: string, auth: string, testo: string) {
  const uaPub = deb64u(p256dh)
  const segreto = deb64u(auth)
  const mia = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', mia.publicKey))
  const loro = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: loro }, mia.privateKey, 256))
  const ikm = await hkdf(segreto, ecdh, unisci(enc.encode('WebPush: info\0'), uaPub, asPub), 32)
  const sale = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(sale, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(sale, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cifrato = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, unisci(enc.encode(testo), new Uint8Array([2]))))
  const rs = new Uint8Array([0, 0, 16, 0]) // 4096
  return unisci(sale, rs, new Uint8Array([asPub.length]), asPub, cifrato)
}

type Iscrizione = { id: string, endpoint: string, p256dh: string, auth: string }
async function manda(i: Iscrizione, messaggio: Record<string, unknown>) {
  const corpo = await cifra(i.p256dh, i.auth, JSON.stringify(messaggio))
  const r = await fetch(i.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await firmaVapid(new URL(i.endpoint).origin),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high',
    },
    body: corpo,
  })
  return { stato: r.status, testo: r.ok ? '' : (await r.text()).slice(0, 200) }
}

// ---------- WhatsApp per i guasti (21.10.2026, ok di Giovanni) ----------
// Dal numero di prova di Meta al numero di Giovanni (tra i 5 destinatari di prova), con il modello approvato
// "avviso_guasto" (fuori dalle 24 ore si possono mandare solo modelli). Gratis per i numeri di prova.
// Segreti messi da scripts/salva-avvisi-whatsapp.mjs; senza, niente WhatsApp.
const WA_TOKEN = Deno.env.get('WA_AVVISI_TOKEN')
const WA_DA = Deno.env.get('WA_AVVISI_PHONE_ID')
const WA_A = Deno.env.get('WA_AVVISI_A')
async function whatsapp(titolo: string, corpo: string) {
  // Nei parametri dei modelli Meta non vuole a capo né tanti spazi di fila.
  const pulisci = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 500) || '-'
  const r = await fetch(`https://graph.facebook.com/v26.0/${WA_DA}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: WA_A, type: 'template',
      template: { name: 'avviso_guasto', language: { code: 'it' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: pulisci(titolo) }, { type: 'text', text: pulisci(corpo) }] }] },
    }),
  })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
}

// ---------- Cosa avvisare ----------
const oraZurigo = (iso: string) => new Date(iso).toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })
const corto = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

type Avviso = { tipo: string, rif_id: string, chiave: string, titolo: string, corpo: string, url: string }

async function daAvvisare(): Promise<Avviso[]> {
  const adesso = Date.now()
  const iso = (ms: number) => encodeURIComponent(new Date(ms).toISOString())
  const avvisi: Avviso[] = []

  const eventi = await rest(`eventi?select=id,titolo,inizio,luogo,area,cambio,azienda_id,aziende(nome)&stato=in.(confermato,da_creare)`
    + `&fatto_il=is.null&tutto_il_giorno=is.false&inizio=gte.${iso(adesso - 6 * 3600e3)}&inizio=lte.${iso(adesso + 6 * 3600e3)}`)
  for (const e of eventi) {
    const inizio = e.cambio?.inizio || e.inizio
    const titolo = e.cambio?.titolo || e.titolo || 'Appuntamento'
    if (/^scuola chiusa/i.test(titolo) || e.cambio?.tutto_il_giorno) continue
    const mancano = (Date.parse(inizio) - adesso) / 60000
    if (mancano <= 0 || mancano > PRIMA_MIN + 2) continue
    const luogo = e.cambio?.luogo ?? e.luogo
    avvisi.push({
      tipo: 'appuntamento', rif_id: e.id, chiave: new Date(inizio).toISOString(),
      titolo: `${oraZurigo(inizio)} ${titolo}`,
      corpo: [mancano > 50 ? 'Tra un\'ora' : `Tra ${Math.round(mancano)} minuti`, luogo, e.aziende?.nome].filter(Boolean).join(' · '),
      url: e.azienda_id ? `/#/azienda/${e.azienda_id}` : '/#/oggi',
    })
  }

  // Dal 14.10.2026 (scelta di Giovanni) tutti i promemoria con un'ora suonano, non solo gli urgenti.
  // Solo quelli arrivati all'ora negli ultimi 30 minuti: niente raffica di promemoria vecchi.
  const promemoria = await rest(`promemoria?select=id,testo,scade_il,urgente,area&fatto_il=is.null&eliminata_il=is.null`
    + `&scade_il=lte.${iso(adesso)}&scade_il=gte.${iso(adesso - 30 * 60e3)}`)
  for (const p of promemoria) {
    avvisi.push({
      tipo: 'promemoria', rif_id: p.id, chiave: new Date(p.scade_il).toISOString(),
      titolo: `${p.urgente ? '! ' : ''}${corto(p.testo || 'Promemoria', 80)}`, corpo: `Promemoria delle ${oraZurigo(p.scade_il)}`, url: '/#/oggi',
    })
  }

  // (13.10.2026 sera: prima c'era anche "da=is.null", che non era mai vero: le risposte del Capo non suonavano.)
  // Una segnalazione senza niente da fare il Capo la segna già vista (vista_il): niente notifica.
  const risposte = await rest(`richieste_agenti?select=id,testo,risposta,da&agente=eq.capo&vista_il=is.null`
    + `&risposta=not.is.null&risposta_il=gte.${iso(adesso - 2 * 3600e3)}`)
  for (const r of risposte) {
    avvisi.push({ tipo: 'capo_risposta', rif_id: r.id, chiave: '', titolo: r.da === 'ceramex' ? 'Il Capo: mail privata' : 'Il Capo ti ha risposto',
      corpo: corto(r.risposta, 160), url: '/#/capo' })
  }

  const conferme = await rest(`capo_conferme?select=id,cosa&stato=eq.da_confermare&creata_il=gte.${iso(adesso - 2 * 3600e3)}`)
  for (const c of conferme) {
    avvisi.push({ tipo: 'capo_conferma', rif_id: c.id, chiave: '', titolo: 'Il Capo chiede una conferma', corpo: corto(c.cosa, 160), url: '/#/capo' })
  }

  // Guardiano (21.10.2026): un avviso quando un guasto si apre e uno quando si chiude,
  // "Risolto" solo per i guasti già avvisati.
  const guasti = await rest(`guasti?select=id,titolo,dettaglio,chiuso_il&or=(chiuso_il.is.null,chiuso_il.gte.${iso(adesso - 2 * 3600e3)})`
    + `&aperto_il=gte.${iso(adesso - 2 * 864e5)}`)
  const chiusi = guasti.filter((g: { chiuso_il: string | null }) => g.chiuso_il)
  const avvisati = new Set(chiusi.length
    ? (await rest(`notifiche_inviate?select=rif_id&tipo=eq.guasto&rif_id=in.(${chiusi.map((g: { id: string }) => g.id).join(',')})`)).map((n: { rif_id: string }) => n.rif_id)
    : [])
  for (const g of guasti) {
    if (!g.chiuso_il) {
      avvisi.push({ tipo: 'guasto', rif_id: g.id, chiave: '', titolo: `Guasto: ${corto(g.titolo, 80)}`, corpo: corto(g.dettaglio || '', 160), url: '/#/oggi' })
    } else if (avvisati.has(g.id)) {
      avvisi.push({ tipo: 'guasto_risolto', rif_id: g.id, chiave: '', titolo: `Risolto: ${corto(g.titolo, 80)}`, corpo: 'Il guardiano lo vede di nuovo a posto.', url: '/#/oggi' })
    }
  }
  return avvisi
}

Deno.serve(async (req) => {
  if (!COPIA_TOKEN || req.headers.get('x-copia-token') !== COPIA_TOKEN) return new Response('Non autorizzato', { status: 401 })
  // Prova (per i controlli di Claude): dice cosa manderebbe adesso, senza mandare né segnare niente.
  const { prova } = await req.json().catch(() => ({}))
  if (prova) {
    const iscrizioni = await rest('push_iscrizioni?select=id')
    return Response.json({ prova: true, iscrizioni: iscrizioni.length, avvisi: await daAvvisare() })
  }
  const mandate: string[] = []
  const errori: string[] = []
  try {
    const iscrizioni: Iscrizione[] = await rest('push_iscrizioni?select=id,endpoint,p256dh,auth')
    // Nessun telefono iscritto (e niente WhatsApp per i guasti): non segno niente come mandato.
    if (!iscrizioni.length && !WA_TOKEN) return Response.json({ ok: true, iscrizioni: 0 })

    for (const a of await daAvvisare()) {
      if (!iscrizioni.length && !a.tipo.startsWith('guasto')) continue
      // Segno prima di mandare: se due giri si sovrappongono, solo uno lo manda.
      const nuova = await rest('notifiche_inviate?on_conflict=tipo,rif_id,chiave', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ tipo: a.tipo, rif_id: a.rif_id, chiave: a.chiave, titolo: a.titolo }),
      })
      if (!nuova?.length) continue
      // Guasti anche su WhatsApp, dal numero di prova di Meta (passo 2 del guardiano).
      if (a.tipo.startsWith('guasto') && WA_TOKEN) {
        await whatsapp(a.titolo, a.corpo).catch((e) => errori.push(`whatsapp: ${(e as Error).message}`))
      }
      for (const i of iscrizioni) {
        try {
          // "Risolto" prende il posto della notifica del guasto sul telefono (stesso tag).
          const tag = `${a.tipo === 'guasto_risolto' ? 'guasto' : a.tipo}-${a.rif_id}`
          const r = await manda(i, { titolo: a.titolo, corpo: a.corpo, url: a.url, tag })
          if (r.stato === 404 || r.stato === 410) {
            // Il telefono non è più iscritto (app tolta o permesso revocato).
            await rest(`push_iscrizioni?id=eq.${i.id}`, { method: 'DELETE' })
          } else if (r.stato >= 300) {
            errori.push(`${a.tipo}: ${r.stato} ${r.testo}`)
            await rest(`push_iscrizioni?id=eq.${i.id}`, { method: 'PATCH', body: JSON.stringify({ errore: `${r.stato} ${r.testo}`.slice(0, 300) }) })
          } else {
            await rest(`push_iscrizioni?id=eq.${i.id}`, { method: 'PATCH', body: JSON.stringify({ ultima_ok: new Date().toISOString(), errore: null }) })
          }
        } catch (e) {
          errori.push(`${a.tipo}: ${(e as Error).message}`)
        }
      }
      mandate.push(a.titolo)
    }
  } catch (e) {
    errori.push((e as Error).message)
  }
  // Registro solo quando succede qualcosa.
  if (mandate.length || errori.length) {
    await rest('lavori_registro', {
      method: 'POST',
      body: JSON.stringify({ lavoro: 'notifiche', ok: !errori.length, dettagli: { mandate, errori, riepilogo: mandate.length ? `Mandate ${mandate.length} notifiche` : errori[0] } }),
    }).catch(() => {})
  }
  return Response.json({ ok: !errori.length, mandate: mandate.length, errori })
})
