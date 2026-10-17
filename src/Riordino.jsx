import { useEffect, useState } from 'react'
import { sb, quando } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Indietro, useModifiche, useDueTocchi, Icona } from './componenti'

// Riordino delle caselle (ok di Giovanni): info@ G&C dal 12.10.2026 sera (l'agente "Archiviazione email G&C" propone la
// cartella di Hostpoint per Posta in arrivo e Posta inviata) e Gmail Ceramex dal 12.10 notte (l'agente "Bozze mail Ceramex"
// propone l'etichetta per le conversazioni in Posta in arrivo). Qui Giovanni spunta quelle che vanno bene (o cambia la
// cartella) e preme "Sposta": la funzione riordino-mail le sposta subito. Niente si sposta senza questo tocco.
// "Tieni in vista" = l'agente non la ripropone più. Si vedono le caselle dell'area scelta (C, G o tutte e due).
// "Rispondi all'agente" (13.10.2026, info@ e dal pomeriggio anche Gmail Ceramex → agente 'ceramex'): Giovanni scrive cosa vuole ("mettila in AMARARE/ROMBACH", "crea la
// cartella DENIS sotto G&C"); parte una richiesta all'agente Archiviazione (richieste_agenti.riordino_id) con le istruzioni
// dentro, l'agente la fa partire subito e cambia solo la proposta. Le mail le sposta sempre Giovanni con "Sposta".

const CASELLE = [['gc', 'INBOX', 'Posta in arrivo info@'], ['gc', 'Sent', 'Posta inviata info@'], ['ceramex', 'INBOX', 'Gmail Ceramex']]
// "Cestino" (13.10.2026, richiesta di Giovanni) è una cartella speciale: con "Sposta" la mail va nel Cestino della casella
// (Gmail la tiene 30 giorni, Hostpoint finché non lo svuoti). Lo sceglie Giovanni col tasto o lo propone l'agente.
const CESTINO = 'Cestino'
const corta = (c) => (c === CESTINO ? '🗑 Cestino' : c ? c.replace(/^Archive\//, '').replace(/^INBOX\/\d{4}\//, '') : '')
const caselleDi = (area) => (area === 'C' ? ['ceramex'] : area === 'G' ? ['gc'] : ['gc', 'ceramex'])
const nomeBreve = (da) => (da || '').replace(/\s*<[^>]+>\s*/, '').replace(/^"|"$/g, '') || da || ''
const IN_CORSO = ['nuova', 'avviata', 'in_corso']
// La prima riga della richiesta sono le parole di Giovanni: «…»
const paroleDi = (q) => (q.testo.split('\n')[0].match(/«(.*)»/) || [])[1] || q.testo

// Chi riceve le istruzioni: info@ → agente Archiviazione, Gmail Ceramex → agente Ceramex (giro delle ore piene).
// Se Giovanni chiede una bozza di risposta (14.10.2026) va subito all'agente che le scrive: info@ → agente G&C, Gmail → Ceramex.
// Prima passava dall'Archiviazione (che le bozze non le fa) e poi dallo smistatore: troppi giri.
const AGENTE_DI = { gc: 'archiviazione', ceramex: 'ceramex' }
const AGENTE_BOZZA = { gc: 'gc', ceramex: 'ceramex' }
const vuoleBozza = (t) => /\b(bozz[ae]|rispond\w*|rispost[ae]|scrivi(gli|le)?|preparal?[ae]?|replica)\b/i.test(t)
const parlaDiCartella = (t) => /\b(cartell[ae]|etichett[ae]|mett\w*|spost\w*|archivi\w*|sotto)\b/i.test(t)

// "Manda al Capo" (14.10.2026, idea di Giovanni): le stesse parole vanno al Capo, che fa lui o passa all'agente giusto.
function testoCapo(r, parole) {
  const oggi = new Date().toLocaleDateString('it-CH', { day: '2-digit', month: '2-digit' })
  return [
    `«${parole}»`,
    `(Dal Riordino dell'app, ${oggi}: mail ${r.casella === 'ceramex' ? 'della Gmail Ceramex' : 'di info@homeconcepts.ch'} «${r.oggetto || '(senza oggetto)'}» di ${r.da || '?'} del ${(r.data_email || '').slice(0, 10)}.`,
    r.casella === 'ceramex'
      ? `Gmail: gmail_thread_id ${r.gmail_thread_id || r.message_id}. Riga riordino_mail id = '${r.id}', etichetta proposta: ${r.cartella_proposta || 'nessuna'}.)`
      : `info@: message_id ${r.message_id}, ora in ${r.cartella_da} (in posta: stesso message_id). Riga riordino_mail id = '${r.id}', cartella proposta: ${r.cartella_proposta || 'nessuna'}.)`,
  ].join('\n')
}

function testoBozza(r, parole) {
  const oggi = new Date().toLocaleDateString('it-CH', { day: '2-digit', month: '2-digit' })
  const quale = r.casella === 'ceramex'
    ? `la conversazione Gmail «${r.oggetto || '(senza oggetto)'}» di ${r.da || '?'} (gmail_thread_id ${r.gmail_thread_id || r.message_id})`
    : `la mail di info@ «${r.oggetto || '(senza oggetto)'}» di ${r.da || '?'} del ${(r.data_email || '').slice(0, 10)} (message_id ${r.message_id}; in posta: stesso message_id e la sua conversazione thread_key)`
  return [
    `«${parole}»`,
    `Bozza di risposta chiesta da Giovanni dal Riordino dell'app (${oggi}) per ${quale}.`,
    r.casella === 'ceramex'
      ? 'Cosa fare: leggi la conversazione (get_thread) e prepara UNA bozza di risposta nella Gmail come nel passo delle bozze (create_draft nella stessa conversazione, all\'ultimo messaggio, e la sua riga in mail_bozze), seguendo le parole di Giovanni (lingua, tono, cosa dire). Vale anche se di solito non l\'avresti fatta.'
      : 'Cosa fare: leggi la mail e la sua conversazione in posta e prepara UNA bozza di risposta come nelle regole BOZZE DI RISPOSTA (tabella bozze, stesso thread_key), seguendo le parole di Giovanni (lingua, tono, cosa dire). Vale anche se la mail è vecchia o se di solito non l\'avresti fatta. Se la mail non c\'è ancora in posta, dillo nella risposta.',
    'Mai inventare prezzi, date o quantità: se servono e non li trovi scritti, metti [DA COMPLETARE] nel testo e dillo nella risposta. Non mandare niente: la bozza la approva Giovanni nella schermata Bozze.',
    'Risposta: una frase («Bozza pronta in Bozze» oppure cosa manca).',
  ].join('\n')
}

// "Rispondi" e "Inoltra" (13.10.2026 sera, la "via di mezzo" scelta da Giovanni): la firma come la scrive lui.
const FIRMA = {
  gc: 'Saluti\nGiovanni',
  ceramex: 'Saluti\nGiovanni\n_________________________\nGiovanni Fabris\nSales Agent\nVia Cantonale 4 Centro galleria 3\n6928 Manno',
}

function testoRichiesta(r, parole) {
  const oggi = new Date().toLocaleDateString('it-CH', { day: '2-digit', month: '2-digit' })
  if (r.casella === 'ceramex') {
    return [
      `«${parole}»`,
      `Riordino della Gmail Ceramex (PASSO 6): questa è la risposta di Giovanni (dall'app, ${oggi}) sulla conversazione «${r.oggetto || '(senza oggetto)'}» di ${r.da || '?'} del ${(r.data_email || '').slice(0, 10)}, in Posta in arrivo.`,
      `Riga: riordino_mail id = '${r.id}' (casella 'ceramex'). Etichetta proposta adesso: ${r.cartella_proposta || 'nessuna'}${r.nuova ? ' (nuova)' : ''}${r.dubbio ? `. Il tuo dubbio era: ${r.dubbio}` : ''}.`,
      'Cosa fare: capisci quale etichetta vuole Giovanni. Guarda le etichette esistenti (list_labels, solo quelle utente) e usa il nome esatto (es. INBOX/2025/Marazzi group). Un\'etichetta nuova va sotto INBOX/2025/… come le altre.',
      `Poi: update riordino_mail set cartella_proposta = '<etichetta>', nuova = <true se l'etichetta non esiste ancora, altrimenti false>, dubbio = null, motivo = 'Etichetta chiesta da Giovanni il ${oggi}: <riassunto in poche parole>', aggiornata_il = now() where id = '${r.id}' and casella = 'ceramex' and stato = 'proposta';`,
      'Fai lo stesso con le altre conversazioni in proposta dello stesso tipo, se ci sono, e dillo nella risposta. Nei giri dopo non cambiare più l\'etichetta delle righe con motivo "Etichetta chiesta da Giovanni…".',
      'Non cambiare etichette in Gmail e non archiviare niente: le sposta Giovanni con "Sposta" (un\'etichetta nuova si crea in quel momento). Se non capisci cosa vuole, non cambiare niente e nella risposta fagli una domanda precisa.',
      'Risposta: una frase con l\'etichetta scelta (scrivi "nuova" se non esiste ancora).',
    ].join('\n')
  }
  return [
    `«${parole}»`,
    `Riordino casella: questa è la risposta di Giovanni (dall'app, ${oggi}) sulla mail «${r.oggetto || '(senza oggetto)'}» di ${r.da || '?'} del ${(r.data_email || '').slice(0, 10)}, ora in ${r.cartella_da}.`,
    `Riga: riordino_mail id = '${r.id}'. Proposta attuale: ${r.cartella_proposta || 'nessuna'}${r.nuova ? ' (nuova)' : ''}${r.dubbio ? `. Il tuo dubbio era: ${r.dubbio}` : ''}.`,
    'Cosa fare: capisci quale cartella vuole Giovanni. Guarda l\'elenco delle cartelle (email-casella {"azione":"cartelle"}) e scrivi il percorso completo con il nome esatto, come le altre proposte (es. Archive/CLIENTI /AMINI/RÜSCHLIKON).',
    `Poi: update riordino_mail set cartella_proposta = '<percorso>', nuova = <true se la cartella non esiste ancora, altrimenti false>, dubbio = null, motivo = 'Cartella chiesta da Giovanni il ${oggi}: <riassunto in poche parole>', aggiornata_il = now() where id = '${r.id}' and stato = 'proposta';`,
    'Fai lo stesso con le altre mail in proposta dello stesso cliente e dello stesso riferimento, se ci sono, e dillo nella risposta. È una regola nuova: vale anche per le mail che arriveranno (passo R0).',
    'Non spostare mail e non creare cartelle: le sposta Giovanni con "Sposta" (una cartella nuova si crea in quel momento). Se non capisci cosa vuole, non cambiare niente e nella risposta fagli una domanda precisa.',
    'Risposta: una frase con la cartella scelta (scrivi "nuova" se non esiste ancora).',
  ].join('\n')
}

export function Riordino() {
  const { avvisa, area } = useApp()
  const [scelte, setScelte] = useState({})   // id → true
  const [cambi, setCambi] = useState({})     // id → cartella scelta da Giovanni
  const [aperta, setAperta] = useState(null) // riga con la scelta della cartella aperta
  const [cartelle, setCartelle] = useState({}) // casella → elenco
  const due = useDueTocchi()
  const conferma = due.armato === 'sposta'
  const setConferma = (v) => { if (!v) due.disarma() }
  const [lavoro, setLavoro] = useState(false)
  const [risponde, setRisponde] = useState(null) // riga con il campo "Rispondi all'agente" aperto
  const [letta, setLetta] = useState(null)       // { id, dati | errore } della mail aperta con "Leggi email"
  const [parole, setParole] = useState('')
  const [scrive, setScrive] = useState(null)     // { id, tipo: 'rispondi'|'inoltra', testo, a, cc, ccn: [{ mail, nome }], copie, tutti, prima: {a, cc} }
  const quante = Object.values(scelte).filter(Boolean).length
  useModifiche(quante > 0 || Object.keys(cambi).length > 0 || !!parole.trim() || !!scrive?.cambiato)

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [righe, spostate, risposte] = await Promise.all([
      sb.from('riordino_mail').select('*').in('casella', caselleDi(area)).in('stato', ['proposta', 'tenere']).order('data_email', { ascending: false }).then(chk),
      sb.from('riordino_mail').select('id,oggetto,da,cartella_finale,spostata_il').in('casella', caselleDi(area)).eq('stato', 'spostata')
        .gte('spostata_il', new Date(Date.now() - 86400e3).toISOString()).order('spostata_il', { ascending: false }).then(chk),
      sb.from('richieste_agenti').select('id,riordino_id,testo,stato,risposta,creata_il,vista_il').not('riordino_id', 'is', null)
        .gte('creata_il', new Date(Date.now() - 7 * 86400e3).toISOString()).order('creata_il', { ascending: false }).then(chk),
    ])
    // L'ultima risposta di Giovanni per ogni mail.
    const ultima = {}
    for (const q of risposte) ultima[q.riordino_id] ||= q
    return { righe, spostate, ultima }
  }, [area])

  // Le risposte degli agenti che vedi qui sotto le mail contano come lette (spengono la notifica di Agenti).
  useEffect(() => {
    const ids = Object.values(dati?.ultima || {}).filter((q) => q.risposta && !q.vista_il).map((q) => q.id)
    if (ids.length) sb.from('richieste_agenti').update({ vista_il: new Date().toISOString() }).in('id', ids).then(() => {})
  }, [dati])

  // Mentre l'agente lavora su una risposta, la schermata si rilegge ogni 20 secondi (per 15 minuti al massimo).
  const inAttesa = Object.values(dati?.ultima || {}).some((q) => IN_CORSO.includes(q.stato) && Date.now() - new Date(q.creata_il) < 15 * 60e3)
  useEffect(() => {
    if (!inAttesa) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') ricarica() }, 20000)
    return () => clearInterval(t)
  }, [inAttesa, ricarica])

  // "Leggi email" (13.10.2026): il testo della mail (o degli ultimi messaggi della conversazione Gmail) e gli allegati.
  async function leggiMail(r) {
    if (letta?.id === r.id) { setLetta(null); return }
    setLetta({ id: r.id })
    try {
      setLetta({ id: r.id, dati: await chiama('riordino-mail', { azione: 'leggi', id: r.id }) })
    } catch (e) {
      setLetta({ id: r.id, errore: messaggioErrore(e) })
    }
  }
  async function apriAllegato(r, a) {
    // La finestra si apre subito (dopo l'attesa il telefono la bloccherebbe), poi riceve il file.
    const finestra = window.open('', '_blank')
    try {
      avvisa(`Apro ${a.nome}…`)
      const f = await chiama('riordino-mail', { azione: 'allegato', id: r.id, rif: a.rif })
      const bytes = Uint8Array.from(atob(f.dati), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: f.tipo }))
      if (finestra) finestra.location.href = url
      else {
        const link = document.createElement('a')
        link.href = url
        link.download = f.nome
        link.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 120000)
    } catch (e) {
      finestra?.close()
      avvisa(messaggioErrore(e))
    }
  }

  // Apre il riquadro per rispondere o inoltrare. Per la risposta chiede subito a chi andrebbe (prova: non manda niente).
  async function apriScrivi(r, tipo) {
    if (scrive?.id === r.id && scrive.tipo === tipo) { setScrive(null); return }
    const casella = r.casella || 'gc'
    const testo = `\n\n${FIRMA[casella]}`
    setScrive({ id: r.id, tipo, testo, a: [], cc: [], ccn: [], copie: false, tutti: false, prima: null })
    setRisponde(null)
    setAperta(null)
    if (tipo !== 'rispondi') return
    try {
      // Chi ti ha scritto entra già in A; chi era in copia si aggiunge con "Rispondi a tutti". Si può togliere e aggiungere.
      const p = await chiama('riordino-mail', { azione: 'rispondi', id: r.id, testo: FIRMA[casella], tutti: true, prova: true })
      setScrive((s) => (s?.id === r.id && s.tipo === tipo
        ? { ...s, prima: { a: p.a, cc: p.cc }, a: [...p.a.map((mail) => ({ mail })), ...s.a.filter((x) => !p.a.includes(x.mail))] } : s))
    } catch (e) {
      setScrive((s) => (s?.id === r.id ? { ...s, prima: { errore: messaggioErrore(e) } } : s))
    }
  }
  const cambiaDest = (campo, v) => { due.disarma(); setScrive((s) => ({ ...s, [campo]: v, cambiato: true })) }
  function rispondiATutti(si) {
    due.disarma()
    setScrive((s) => {
      const altri = s.prima.cc.filter((m) => !s.a.some((x) => x.mail === m) && !s.ccn.some((x) => x.mail === m))
      const cc = si ? [...s.cc, ...altri.filter((m) => !s.cc.some((x) => x.mail === m)).map((mail) => ({ mail }))]
        : s.cc.filter((x) => !s.prima.cc.includes(x.mail))
      return { ...s, tutti: si, cc }
    })
  }
  const destinatari = (s) => ({ a: s.a.map((x) => x.mail), cc: s.cc.map((x) => x.mail), ccn: s.ccn.map((x) => x.mail) })
  const elencoDest = (s) => {
    const d = destinatari(s)
    return [d.a.join(', '), d.cc.length && `Cc ${d.cc.join(', ')}`, d.ccn.length && `Ccn ${d.ccn.join(', ')}`].filter(Boolean).join(' · ')
  }

  async function manda(r) {
    const s = scrive
    if (!s.testo.trim() || s.testo.trim() === FIRMA[r.casella || 'gc']) return avvisa('Scrivi il testo')
    if (!s.a.length) return avvisa(s.tipo === 'inoltra' ? 'Scrivi a chi inoltrarla (nome o indirizzo mail)' : 'Metti almeno un indirizzo in A')
    due.tocca(`manda-${r.id}`, () => mandaDavvero(r, s))
  }
  async function mandaDavvero(r, s) {
    setLavoro(true)
    try {
      const esito = await chiama('riordino-mail', { azione: s.tipo, id: r.id, testo: s.testo, ...destinatari(s) })
      setScrive(null)
      avvisa(esito.esito || (s.tipo === 'rispondi' ? 'Risposta mandata' : 'Inoltrata'))
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  async function alCapo(r) {
    const t = parole.trim().replace(/\s+/g, ' ')
    if (!t) return avvisa('Scrivi cosa deve fare il Capo')
    setLavoro(true)
    try {
      const q = chk(await sb.from('richieste_agenti').insert({ agente: 'capo', testo: testoCapo({ ...r, casella: r.casella || 'gc' }, t), riordino_id: r.id }).select('id').single())
      setParole('')
      setRisponde(null)
      const esito = await chiama('agente-subito', { id: q.id }).catch(() => ({ ok: false }))
      avvisa(esito.ok ? 'Mandata al Capo: la risposta arriva qui e nel tasto Capo' : 'Il Capo non è partito: riprova tra un minuto')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  async function rispondi(r) {
    const t = parole.trim().replace(/\s+/g, ' ')
    if (!t) return avvisa('Scrivi cosa deve fare l\'agente')
    setLavoro(true)
    try {
      const casella = r.casella || 'gc'
      const bozza = vuoleBozza(t)
      const cartella = !bozza || parlaDiCartella(t)
      // Una richiesta per agente: la bozza all'agente che scrive le risposte, la cartella a chi la propone.
      const richieste = [
        ...(bozza ? [{ agente: AGENTE_BOZZA[casella], testo: testoBozza({ ...r, casella }, t), riordino_id: r.id }] : []),
        ...(cartella ? [{ agente: AGENTE_DI[casella], testo: testoRichiesta({ ...r, casella }, t), riordino_id: r.id }] : []),
      ]
      const fatte = chk(await sb.from('richieste_agenti').insert(richieste).select('id'))
      setParole('')
      setRisponde(null)
      if (cartella) {
        setCambi((c) => { const n = { ...c }; delete n[r.id]; return n })
        segna([r.id], false)
      }
      const esiti = await Promise.all(fatte.map((q) => chiama('agente-subito', { id: q.id }).catch(() => ({ ok: false }))))
      const partite = esiti.every((e) => e.ok)
      avvisa(bozza && !cartella
        ? (partite ? 'Mandata: l\'agente prepara la bozza, la trovi in Bozze tra qualche minuto' : 'Mandata: la bozza la prepara la prossima volta che l\'agente lavora')
        : partite ? `Mandata: l'agente ${bozza ? 'prepara la bozza e ' : ''}cambia la proposta tra qualche minuto`
          : `Mandata: la fa la prossima volta che l'agente lavora (${casella === 'ceramex' ? 'ogni ora piena, 6–23' : 'ogni 2 ore, 6–22'})`)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  const cartellaDi = (r) => cambi[r.id] || r.cartella_proposta || ''
  const segna = (ids, si) => { setConferma(false); setScelte((s) => { const n = { ...s }; ids.forEach((id) => { n[id] = si }); return n }) }

  // "Cestino": la mail passa nel gruppo 🗑 Cestino già scelta; si cestina solo con "Sposta" (due tocchi). Ritoccando torna com'era.
  function cestina(r) {
    setAperta(null)
    if (cambi[r.id] === CESTINO) {
      setCambi((c) => { const n = { ...c }; delete n[r.id]; return n })
      segna([r.id], false)
    } else if (!cambi[r.id] && r.cartella_proposta === CESTINO) {
      segna([r.id], !scelte[r.id])
    } else {
      setCambi((c) => ({ ...c, [r.id]: CESTINO }))
      segna([r.id], true)
    }
  }

  async function apriScelta(r) {
    setAperta(aperta === r.id ? null : r.id)
    const casella = r.casella || 'gc'
    if (cartelle[casella]) return
    try {
      const elenco = (await chiama('riordino-mail', { azione: 'cartelle', casella })).cartelle
      setCartelle((c) => ({ ...c, [casella]: elenco }))
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  // Due tocchi (useDueTocchi): il secondo conta dopo mezzo secondo, dopo 5 secondi il tasto torna com'era.
  const sposta = () => due.tocca('sposta', spostaDavvero)
  async function spostaDavvero() {
    setLavoro(true)
    const voci = Object.keys(scelte).filter((id) => scelte[id]).map((id) => ({ id, ...(cambi[id] ? { cartella: cambi[id] } : {}) }))
    const tot = { spostate: 0, sparite: 0, errori: [] }
    try {
      for (let i = 0; i < voci.length; i += 50) {
        const r = await chiama('riordino-mail', { azione: 'sposta', voci: voci.slice(i, i + 50) })
        tot.spostate += r.spostate || 0
        tot.sparite += r.sparite || 0
        tot.errori.push(...(r.errori || []))
      }
      avvisa(tot.errori.length ? `Spostate ${tot.spostate}, ${tot.errori.length} non riuscite (vedi in rosso)`
        : `Spostate ${tot.spostate} mail${tot.sparite ? ` (${tot.sparite} non c'erano più)` : ''}`)
      setScelte({})
      setCambi({})
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
      ricarica()
    }
  }

  async function tieni() {
    const ids = Object.keys(scelte).filter((id) => scelte[id])
    try {
      chk(await sb.from('riordino_mail').update({ stato: 'tenere', aggiornata_il: new Date().toISOString() }).in('id', ids))
      avvisa(ids.length === 1 ? 'La lascio in casella: non te la ripropongo' : `Ne lascio in casella ${ids.length}: non te le ripropongo`)
      setScelte({})
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  // Righe e gruppi come funzioni semplici (non componenti): così la scelta della cartella non si richiude a ogni tocco.
  function riga(r) {
    const cartella = cartellaDi(r)
    const scelta = !!scelte[r.id]
    const q = dati.ultima[r.id]
    const lavora = q && IN_CORSO.includes(q.stato)
    const puoRispondere = r.stato === 'proposta' && !lavora
    return (
      <div key={r.id} className="voce-riordino">
        <div className={'riga riga-riordino' + (scelta ? ' scelta' : '')}>
          <button type="button" className="spunta-mail" aria-pressed={scelta} disabled={!cartella}
            aria-label={scelta ? 'Togli dalla scelta' : 'Scegli per spostarla'} onClick={() => segna([r.id], !scelta)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          </button>
          <span className="riga-corpo">
            <span className="riga-testo">{r.oggetto || '(senza oggetto)'}</span>
            <span className="riga-meta">
              {r.non_letta && <span title="Non letta">🔵 </span>}{r.stellina && <span title="Con la stellina">⭐ </span>}
              {r.cartella_da === 'Sent' ? 'a ' : ''}{nomeBreve(r.da)} · {quando(r.data_email, true)}{r.n_messaggi > 1 ? ` · ${r.n_messaggi} messaggi` : ''}
            </span>
            {/* Di cosa parla: il motivo scritto dall'agente (13.10.2026, uguale per info@ e Gmail Ceramex). */}
            {r.motivo && !r.dubbio && <span className="riga-meta motivo-riordino">{r.motivo}</span>}
            {r.dubbio && <span className="riga-meta dubbio">❓ {r.dubbio}</span>}
            {r.esito?.startsWith('Non spostata') && <span className="riga-meta rosso">{r.esito}</span>}
            {/^(Risposta|Inoltrata)/.test(r.esito || '') && <span className="riga-meta">✓ {r.esito}</span>}
            {q && (
              <span className={'riga-meta risposta-agente' + (lavora ? ' attesa' : '')}>
                Tu: «{paroleDi(q)}»
                {lavora ? <> · l'agente ci sta lavorando…</> : q.risposta ? <><br />Agente: {q.risposta}</> : null}
              </span>
            )}
            {/* Tasti grandi come un dito (14.10.2026). "Rispondi alla mail" manda una mail vera; "Istruzioni all'agente" no. */}
            <span className="tasti-riga">
              <button type="button" className={'chip tasto-riga' + (letta?.id === r.id ? ' attivo' : '')} onClick={() => leggiMail(r)}>
                {letta?.id === r.id ? 'Chiudi la mail' : 'Leggi'}
              </button>
              <button type="button" className={'chip tasto-riga' + (aperta === r.id ? ' attivo' : '')} onClick={() => apriScelta(r)}>
                {cambi[r.id] && cambi[r.id] !== CESTINO ? `Cambiata: ${corta(cambi[r.id])}` : cartella && cartella !== CESTINO ? (r.casella === 'ceramex' ? 'Altra etichetta' : 'Altra cartella') : (r.casella === 'ceramex' ? "Scegli l'etichetta" : 'Scegli la cartella')}
              </button>
              <button type="button" className={'chip tasto-riga tasto-cestino' + (cartella === CESTINO ? ' attivo' : '')} onClick={() => cestina(r)}>
                {cambi[r.id] === CESTINO ? 'Non nel Cestino' : cartella === CESTINO && scelta ? 'Nel Cestino ✓' : 'Cestino'}
              </button>
              <button type="button" className={'chip tasto-riga' + (scrive?.id === r.id && scrive.tipo === 'rispondi' ? ' attivo' : '')} onClick={() => apriScrivi(r, 'rispondi')}>
                {scrive?.id === r.id && scrive.tipo === 'rispondi' ? 'Chiudi la risposta' : 'Rispondi alla mail'}
              </button>
              <button type="button" className={'chip tasto-riga' + (scrive?.id === r.id && scrive.tipo === 'inoltra' ? ' attivo' : '')} onClick={() => apriScrivi(r, 'inoltra')}>
                {scrive?.id === r.id && scrive.tipo === 'inoltra' ? 'Chiudi l\'inoltro' : 'Inoltra'}
              </button>
              {puoRispondere && (
                <button type="button" className={'chip tasto-riga tasto-agente' + (risponde === r.id ? ' attivo' : '')}
                  onClick={() => { setRisponde(risponde === r.id ? null : r.id); setParole(''); setAperta(null); setScrive(null) }}>
                  {r.dubbio ? 'Rispondi al dubbio dell\'agente' : 'Istruzioni all\'agente'}
                </button>
              )}
            </span>
          </span>
        </div>
        {aperta === r.id && (
          <SceltaCartella cartelle={cartelle[r.casella || 'gc']} attuale={cartella}
            onScegli={(c) => { setCambi((x) => ({ ...x, [r.id]: c })); segna([r.id], true); setAperta(null) }} />
        )}
        {letta?.id === r.id && (
          <div className="scelta-cartella mail-letta">
            {letta.errore ? <p className="msg errore">{letta.errore}</p>
              : !letta.dati ? <p className="msg">Leggo la mail…</p>
                : letta.dati.avviso && !letta.dati.messaggi.length ? <p className="msg">{letta.dati.avviso}</p>
                  // Il messaggio più recente in cima (richiesta di Giovanni, 13.10.2026).
                  : [...letta.dati.messaggi].reverse().map((m, i) => (
                    <article key={i} className="messaggio-letto">
                      <p className="riga-meta"><b>{nomeBreve(m.da)}</b>{m.data && !isNaN(new Date(m.data)) ? ` · ${quando(new Date(m.data).toISOString(), true)}` : ''}{m.a ? ` · a ${nomeBreve(m.a)}` : ''}</p>
                      <p className="testo-mail">{m.testo || '(senza testo)'}</p>
                      {m.allegati?.length > 0 && (
                        <div className="chips">
                          {m.allegati.map((a) => (
                            <button key={a.rif} type="button" className="chip piccolo" onClick={() => apriAllegato(r, a)}>📎 {a.nome} · {a.kb} KB</button>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
          </div>
        )}
        {scrive?.id === r.id && (
          <div className="scelta-cartella rispondi-agente scrivi-mail">
            {scrive.tipo === 'rispondi' && !scrive.prima && <p className="riga-meta">Cerco a chi rispondere…</p>}
            {scrive.prima?.errore && <p className="msg errore">{scrive.prima.errore}</p>}
            <CampoIndirizzi etichetta="A" valore={scrive.a} onChange={(v) => cambiaDest('a', v)}
              escludi={[...scrive.cc, ...scrive.ccn]} autoFocus={scrive.tipo === 'inoltra'} />
            {(scrive.copie || scrive.cc.length > 0) && (
              <CampoIndirizzi etichetta="Cc" valore={scrive.cc} onChange={(v) => cambiaDest('cc', v)} escludi={[...scrive.a, ...scrive.ccn]} />
            )}
            {(scrive.copie || scrive.ccn.length > 0) && (
              <CampoIndirizzi etichetta="Ccn" valore={scrive.ccn} onChange={(v) => cambiaDest('ccn', v)} escludi={[...scrive.a, ...scrive.cc]} />
            )}
            {scrive.prima?.cc?.length > 0 && (
              <label className="riga-meta scelta-tutti">
                <input type="checkbox" checked={scrive.tutti} onChange={(e) => rispondiATutti(e.target.checked)} />
                {' '}Rispondi a tutti (in Cc anche {scrive.prima.cc.join(', ')})
              </label>
            )}
            {!scrive.copie
              ? <button type="button" className="tasto-link" onClick={() => setScrive({ ...scrive, copie: true })}>+ Cc / Ccn</button>
              : <p className="nota-piccola">Ccn: ricevono la mail ma gli altri non li vedono.</p>}
            <textarea rows={6} value={scrive.testo} autoFocus={scrive.tipo === 'rispondi'}
              onFocus={(e) => { if (!scrive.cambiato) e.target.setSelectionRange(0, 0) }}
              onChange={(e) => { due.disarma(); setScrive({ ...scrive, testo: e.target.value, cambiato: true }) }}
              placeholder={scrive.tipo === 'rispondi' ? 'Scrivi la risposta' : 'Scrivi due righe (facoltativo) sopra la mail inoltrata'} />
            <p className="nota-piccola">
              {scrive.tipo === 'rispondi' ? 'Sotto aggiungo la mail a cui rispondi.' : 'Sotto aggiungo la mail con i suoi allegati.'}
              {' '}Parte da {r.casella === 'ceramex' ? 'giovannifabris@ceramex.ch' : 'info@homeconcepts.ch'}.
            </p>
            <div className="azioni">
              <button type="button" className={'tasto-grande tasto-manda' + (due.armato === `manda-${r.id}` ? ' conferma' : '')} onClick={() => manda(r)}
                disabled={lavoro || (scrive.tipo === 'rispondi' && !scrive.prima)}>
                {lavoro ? 'Mando…' : due.armato === `manda-${r.id}`
                  ? `Tocca ancora: manda a ${elencoDest(scrive)}`
                  : scrive.tipo === 'rispondi' ? 'Manda la risposta' : 'Inoltra'}
              </button>
              <button type="button" className="tasto-link" onClick={() => setScrive(null)}>Annulla</button>
            </div>
          </div>
        )}
        {risponde === r.id && (
          <div className="scelta-cartella rispondi-agente">
            <textarea rows={3} value={parole} onChange={(e) => setParole(e.target.value)} autoFocus
              placeholder="Es. mettila in AMARARE/ROMBACH · crea la cartella DENIS sotto G&C · fai una bozza di risposta in tedesco: arriva lunedì" />
            <p className="nota-piccola">All'agente: la cartella la cambia chi archivia; una bozza di risposta la prepara l'agente {r.casella === 'ceramex' ? 'Ceramex nella tua Gmail' : 'G&C'} (la trovi in Bozze). Al Capo: qualsiasi altra cosa su questa mail; quelle rischiose solo dopo i tuoi due tocchi. Nessuna mail parte da sola.</p>
            <div className="azioni">
              <button type="button" className="tasto-piccolo" onClick={() => rispondi(r)} disabled={lavoro || !parole.trim()}>Manda all'agente</button>
              <button type="button" className="tasto-piccolo" onClick={() => alCapo(r)} disabled={lavoro || !parole.trim()}>Manda al Capo</button>
              <button type="button" className="tasto-link" onClick={() => { setRisponde(null); setParole('') }}>Annulla</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  function gruppi(righe) {
    const mappa = new Map()
    for (const r of righe) {
      const k = cartellaDi(r)
      if (!mappa.has(k)) mappa.set(k, [])
      mappa.get(k).push(r)
    }
    // Prima le cartelle con più mail; in fondo quelle da decidere.
    const ordine = [...mappa.entries()].sort((a, b) => (!a[0]) - (!b[0]) || b[1].length - a[1].length)
    return ordine.map(([cartella, rr]) => {
      const tutte = rr.every((r) => scelte[r.id])
      const nuova = rr.some((r) => r.nuova && !cambi[r.id])
      return (
        <section key={cartella || '-'} className="gruppo-riordino">
          <div className="gruppo-testa">
            <h3>{cartella ? corta(cartella) : 'Da decidere'}{nuova && <span className="nuova" title="Cartella nuova: si crea se la approvi"> ✚ nuova</span>}</h3>
            {cartella && <button type="button" className="tasto-link" onClick={() => segna(rr.map((r) => r.id), !tutte)}>
              {tutte ? 'Togli tutte' : rr.length === 1 ? 'Scegli' : `Scegli tutte (${rr.length})`}
            </button>}
          </div>
          <div className="elenco">{rr.map(riga)}</div>
        </section>
      )
    })
  }

  const nelCestino = (dati?.righe || []).filter((r) => scelte[r.id] && cartellaDi(r) === CESTINO).length
  const proposte = dati?.righe.filter((r) => r.stato === 'proposta') || []
  const inVista = dati?.righe.filter((r) => r.stato === 'tenere') || []

  return (
    <div className="schermata riordino">
      <Indietro titolo="Riordino casella" />
      <p className="nota-piccola">
        Le mail ancora in Posta in arrivo (e Posta inviata di info@), con la cartella o l'etichetta proposta dall'agente.
        Scegli quelle che vanno bene e premi Sposta. Le altre restano dove sono. Con «Cestino» la mail va nel Cestino della casella (si può ancora recuperare).
      </p>
      <Stato carica={carica} errore={errore}
        vuoto={dati && !dati.righe.length && !dati.spostate.length ? 'Niente da riordinare: gli agenti propongono le mail nuove ogni volta che lavorano.' : null}>
        {dati && (
          <>
            {CASELLE.map(([casella, codice, titolo]) => {
              const rr = proposte.filter((r) => (r.casella || 'gc') === casella && r.cartella_da === codice)
              return rr.length > 0 && (
                <div key={casella + codice} className="casella">
                  <h2>{titolo} <span className="conto">{rr.length}</span></h2>
                  {gruppi(rr)}
                </div>
              )
            })}

            {/* Mail già archiviate che Giovanni ha chiesto di spostare (13.10.2026) */}
            {[...new Set(proposte.filter((r) => (r.casella || 'gc') === 'gc' && !['INBOX', 'Sent'].includes(r.cartella_da)).map((r) => r.cartella_da))].map((da) => {
              const rr = proposte.filter((r) => (r.casella || 'gc') === 'gc' && r.cartella_da === da)
              return (
                <div key={'gc' + da} className="casella">
                  <h2>Da {corta(da)} <span className="conto">{rr.length}</span></h2>
                  {gruppi(rr)}
                </div>
              )
            })}

            {inVista.length > 0 && (
              <div className="casella">
                <h2>Lasciate in casella <span className="conto">{inVista.length}</span></h2>
                <p className="nota-piccola">Le hai lasciate in Posta in arrivo: l'agente non le ripropone. Se vuoi spostarle, sceglile.</p>
                {gruppi(inVista)}
              </div>
            )}

            {dati.spostate.length > 0 && (
              <details className="spostate">
                <summary>Spostate nelle ultime 24 ore ({dati.spostate.length})</summary>
                <div className="elenco">
                  {dati.spostate.map((r) => (
                    <div key={r.id} className="riga">
                      <span className="riga-corpo">
                        <span className="riga-testo">{r.oggetto || '(senza oggetto)'}</span>
                        <span className="riga-meta">→ {corta(r.cartella_finale)} · {quando(r.spostata_il, true)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </Stato>

      {quante > 0 && (
        <div className="barra-riordino">
          <button type="button" className={'tasto-grande' + (conferma ? ' conferma' : '')} onClick={sposta} disabled={lavoro}>
            {lavoro ? 'Sposto…' : `${conferma ? 'Tocca ancora: sposta' : 'Sposta'} ${quante} mail${nelCestino ? ` (${nelCestino === quante ? 'tutte' : nelCestino} nel Cestino)` : ''}`}
          </button>
          <div className="azioni">
            <button type="button" className="tasto-link" onClick={tieni} disabled={lavoro}>Lascia in casella</button>
            <button type="button" className="tasto-link" onClick={() => { setScelte({}); setConferma(false) }} disabled={lavoro}>Annulla la scelta</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Indirizzi di Rispondi e Inoltra (17.10.2026, richiesta di Giovanni): più indirizzi in A, Cc e Ccn; dalla seconda lettera
// propone le persone del brain e i contatti della Rubrica che hanno una mail. Si può sempre scrivere un indirizzo a mano.
const unaMail = (s) => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(s)
const pulisciCerca = (s) => s.replace(/[,()%*\\:]/g, '')

async function cercaIndirizzi(testo) {
  const parole = testo.trim().split(/\s+/).map(pulisciCerca).filter(Boolean)
  if (!parole.length) return []
  let qp = sb.from('persone').select('nome,cognome,email,email_altre').is('eliminata_il', null).not('email', 'is', null).limit(12)
  let qr = sb.from('rubrica').select('nome,cognome,ditta,email').is('eliminata_il', null).neq('email', '[]').limit(20)
  for (const p of parole) {
    qp = qp.or(`nome.ilike.%${p}%,cognome.ilike.%${p}%,email.ilike.%${p}%`)
    qr = qr.or(`nome.ilike.%${p}%,cognome.ilike.%${p}%,ditta.ilike.%${p}%`)
  }
  const [persone, rubrica] = await Promise.all([qp, qr])
  const nome = (x) => [x.nome, x.cognome].filter(Boolean).join(' ') || x.ditta || ''
  const tutte = [
    ...(persone.data || []).flatMap((x) => [x.email, ...(x.email_altre || [])].map((mail) => ({ nome: nome(x), mail }))),
    ...(rubrica.data || []).flatMap((x) => (x.email || []).map((e) => ({ nome: nome(x), mail: e?.valore }))),
  ]
  // Prima chi comincia con quello che hai scritto ("sil" → Silvia…), poi gli altri.
  const inizio = parole[0].toLowerCase()
  const viste = new Set()
  return tutte
    .map((x) => ({ nome: x.nome, mail: String(x.mail || '').trim().toLowerCase() }))
    .filter((x) => unaMail(x.mail) && !viste.has(x.mail) && viste.add(x.mail))
    .sort((x, y) => Number(!x.nome.toLowerCase().startsWith(inizio)) - Number(!y.nome.toLowerCase().startsWith(inizio)))
}

function CampoIndirizzi({ etichetta, valore, onChange, escludi = [], autoFocus = false }) {
  const [testo, setTesto] = useState('')
  const [trovate, setTrovate] = useState([])
  useEffect(() => {
    if (testo.trim().length < 2) { setTrovate([]); return }
    let annullato = false
    const t = setTimeout(async () => {
      const r = await cercaIndirizzi(testo).catch(() => [])
      if (!annullato) setTrovate(r)
    }, 200)
    return () => { annullato = true; clearTimeout(t) }
  }, [testo])

  const gia = new Set([...valore, ...escludi].map((x) => x.mail))
  const proposte = trovate.filter((x) => !gia.has(x.mail)).slice(0, 6)
  const metti = (voci) => {
    const nuove = voci.filter((x, i) => !gia.has(x.mail) && voci.findIndex((y) => y.mail === x.mail) === i)
    if (nuove.length) onChange([...valore, ...nuove])
  }
  // Un indirizzo scritto a mano diventa una pastiglia con virgola, spazio, Invio o uscendo dal campo.
  function scrivi(v) {
    const pezzi = v.split(/[\s,;]+/)
    const resto = pezzi.pop()
    const finiti = pezzi.filter(Boolean)
    if (finiti.length && finiti.every(unaMail)) {
      metti(finiti.map((m) => ({ mail: m.toLowerCase() })))
      setTesto(resto)
    } else setTesto(v)
  }
  function chiudiTesto() {
    const t = testo.trim().toLowerCase()
    if (unaMail(t)) { metti([{ mail: t }]); setTesto('') }
  }

  return (
    <div className="campo-indirizzi">
      <div className="riga-indirizzi">
        <span className="etichetta-indirizzi">{etichetta}</span>
        {valore.map((x) => (
          <span key={x.mail} className="chip attivo chip-indirizzo" title={x.mail}>
            <span className="chip-testo">{x.nome || x.mail}</span>
            <button type="button" aria-label={`Togli ${x.nome || x.mail}`} onClick={() => onChange(valore.filter((v) => v.mail !== x.mail))}>
              <Icona nome="x" size={14} />
            </button>
          </span>
        ))}
        <input type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
          value={testo} autoFocus={autoFocus} placeholder={valore.length ? 'Aggiungi…' : 'Nome o indirizzo mail'}
          aria-label={`Destinatari ${etichetta}`}
          onChange={(e) => scrivi(e.target.value)}
          onBlur={chiudiTesto}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (unaMail(testo.trim())) chiudiTesto()
              else if (proposte[0]) { metti([proposte[0]]); setTesto('') }
            } else if (e.key === 'Backspace' && !testo && valore.length) onChange(valore.slice(0, -1))
          }} />
      </div>
      {proposte.length > 0 && (
        <div className="tendina">
          {proposte.map((x) => (
            <button key={x.mail} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { metti([x]); setTesto('') }}>
              <strong>{x.nome || x.mail}</strong>{x.nome && <span className="riga-meta">{x.mail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Le cartelle che esistono già nella casella (come le legge posta-gc). Cartelle nuove solo se le propone l'agente.
function SceltaCartella({ cartelle, attuale, onScegli }) {
  const [cerca, setCerca] = useState('')
  if (!cartelle) return <div className="scelta-cartella"><p className="msg">Carico le cartelle…</p></div>
  const parole = cerca.toLowerCase().split(/\s+/).filter(Boolean)
  const trovate = cartelle.filter((c) => parole.every((p) => c.toLowerCase().includes(p))).slice(0, 40)
  return (
    <div className="scelta-cartella">
      <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca la cartella (es. Cozza, O0214)" autoFocus />
      <div className="tendina">
        {trovate.map((c) => (
          <button key={c} type="button" className={c === attuale ? 'attuale' : ''} onClick={() => onScegli(c)}>{corta(c)}</button>
        ))}
        {!trovate.length && <p className="msg">Nessuna cartella con questo nome.</p>}
      </div>
    </div>
  )
}
