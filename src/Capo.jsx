import { useEffect, useRef, useState } from 'react'
import { sb, quando } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Icona, useModifiche, useDettatura, useDueTocchi, LinguetteCapo } from './componenti'
import { AGENTI } from './Agenti'
import { IN_ATTESA, useSezioni, Sezione, vaiInFondo } from './sezioni'

// Agente capo (13.10.2026, tasto "Capo" in basso accanto a Chiedi): Giovanni scrive o detta, il capo risponde qui.
// Le richieste stanno in richieste_agenti (agente = 'capo'); sotto ogni risposta: le cose da confermare con due tocchi
// (capo_conferme) e i lavori passati agli altri agenti (richieste con da = 'capo' e origine_id).
// In alto le "Modifiche per Claude Code" (modifiche_claude): le fa Claude sul PC solo con l'ok di Giovanni.
// La chat è divisa in sezioni, una per argomento (15.10.2026): sezioni.jsx.

const NOME_AGENTE = Object.fromEntries(AGENTI.map((a) => [a.codice, a.nome]))
const TIPO = { mail: 'Mail', messaggio: 'Messaggio', cancella: 'Cancellare', gestionale: 'Gestionale', sposta_mail: 'Spostare mail', calendario: 'Calendario', altro: 'Da confermare' }
const APP = { brain: 'Brain', ceramex: 'App Ceramex', gc: 'App G&C' }

// Cose che il Capo chiede di confermare (nel numero del tasto Capo, insieme a risposte e domande: App.jsx).
export async function contaConferme() {
  const { count } = await sb.from('capo_conferme').select('id', { count: 'exact', head: true }).eq('stato', 'da_confermare')
  return count || 0
}

export function Capo() {
  const { avvisa } = useApp()
  const [testo, setTesto] = useState('')
  const [invio, setInvio] = useState(false)
  const scrivi = useRef(null)
  const primoGiro = useRef(true)
  useModifiche(!!testo.trim())
  const dettatura = useDettatura((t) => setTesto((v) => (v.trim() ? `${v.trim()} ${t}` : t)))

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const richieste = chk(await sb.from('richieste_agenti').select('*').eq('agente', 'capo')
      .order('creata_il', { ascending: false }).limit(60)).reverse()
    const ids = richieste.map((r) => r.id)
    const [passate, conferme, modifiche] = await Promise.all([
      ids.length ? sb.from('richieste_agenti').select('*').eq('da', 'capo').in('origine_id', ids).order('creata_il').then(chk) : [],
      sb.from('capo_conferme').select('*').or(`stato.eq.da_confermare,creata_il.gt.${new Date(Date.now() - 14 * 864e5).toISOString()}`)
        .order('creata_il').then(chk),
      // Quelle da decidere o da fare; le fatte/scartate solo per 3 giorni.
      sb.from('modifiche_claude').select('*').or(`stato.in.(proposta,ok),fatta_il.gt.${new Date(Date.now() - 3 * 864e5).toISOString()},scartata_il.gt.${new Date(Date.now() - 3 * 864e5).toISOString()}`)
        .order('creata_il', { ascending: false }).then(chk),
    ])
    return { richieste, passate, conferme, modifiche }
  }, [])

  // Le risposte che vedi qui contano come lette (anche quelle degli agenti a cui il capo ha passato il lavoro).
  useEffect(() => {
    if (!dati) return
    const da = [...dati.richieste, ...dati.passate].filter((r) => r.risposta_il && !r.vista_il).map((r) => r.id)
    if (da.length) sb.from('richieste_agenti').update({ vista_il: new Date().toISOString() }).in('id', da).then(() => {})
  }, [dati])

  // Sezioni: cosa c'è attorno a ogni richiesta (lavori passati agli agenti, conferme).
  const conferme = (id) => dati.conferme.filter((c) => c.richiesta_id === id)
  const passate = (id) => dati.passate.filter((p) => p.origine_id === id)
  const sez = useSezioni('capo', dati?.richieste, (r) => {
    const cc = conferme(r.id)
    const pp = passate(r.id)
    return {
      attesa: pp.some((p) => IN_ATTESA.includes(p.stato)) || cc.some((c) => c.stato === 'confermata'),
      ferma: cc.some((c) => c.stato === 'da_confermare'),
      ultima: Math.max(0, ...pp.map((p) => Date.parse(p.risposta_il || p.creata_il)), ...cc.map((c) => Date.parse(c.creata_il))),
    }
  })

  // Si apre in fondo, sull'ultimo messaggio.
  useEffect(() => {
    if (!dati || !primoGiro.current) return
    primoGiro.current = false
    vaiInFondo()
  }, [dati])

  function continua(id) {
    sez.continuaQui(id)
    scrivi.current?.focus({ preventScroll: true })
    vaiInFondo()
  }

  // Finché il capo (o un agente a cui ha passato il lavoro) ci lavora, la pagina si aggiorna da sola.
  const attesa = dati && ([...dati.richieste, ...dati.passate].some((r) => IN_ATTESA.includes(r.stato))
    || dati.conferme.some((c) => c.stato === 'confermata'))
  useEffect(() => {
    if (!attesa) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') ricarica() }, 10000)
    return () => clearInterval(t)
  }, [attesa, ricarica])

  async function invia() {
    const t = testo.trim()
    if (!t) return avvisa('Scrivi o detta cosa vuoi')
    if (dettatura.attiva) dettatura.ferma()
    setInvio(true)
    try {
      const r = chk(await sb.from('richieste_agenti').insert({ agente: 'capo', testo: t, sezione_id: sez.sezioneId }).select('id').single())
      setTesto('')
      const esito = await chiama('agente-subito', { id: r.id }).catch((e) => ({ ok: false, errore: messaggioErrore(e) }))
      // Il Capo non ha orari: parte solo così. Se non parte, lo dice (non c'è un "prossimo giro" che lo legga).
      avvisa(esito.ok ? 'Il Capo ci pensa: risponde tra 1–2 minuti'
        : 'Il Capo non è partito. Riprova tra un minuto; se succede ancora, dillo a Claude')
      await ricarica()
      sez.inviato()
      vaiInFondo()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setInvio(false)
    }
  }

  const senzaRichiesta = dati ? dati.conferme.filter((c) => c.stato === 'da_confermare' && !dati.richieste.some((r) => r.id === c.richiesta_id)) : []
  const scambi = (righe) => (
    <div className="chat-capo">
      {righe.map((r) => <Scambio key={r.id} r={r} conferme={conferme(r.id)} passate={passate(r.id)} dopo={ricarica} />)}
    </div>
  )

  return (
    <div className="schermata capo">
      <div className="testata"><h1>Capo</h1></div>
      <LinguetteCapo attiva="capo" />
      <p className="nota-piccola">Scrivimi o dettami cosa ti serve: lo faccio io o lo passo all'agente giusto. Mail, messaggi, cancellazioni e gestionali solo dopo i tuoi due tocchi.</p>

      <Stato carica={carica} errore={errore}>
        {dati && (
          <>
            <Modifiche righe={dati.modifiche} dopo={ricarica} />
            {senzaRichiesta.length > 0 && (
              <div className="chat-capo">
                {senzaRichiesta.map((c) => <Conferma key={c.id} c={c} dopo={ricarica} />)}
              </div>
            )}
            {dati.richieste.length === 0 ? <p className="msg">Ancora niente: scrivi qui sotto la prima cosa.</p> : (
              <>
                {sez.altre.length > 0 && (
                  <div className="sezioni">
                    {sez.altre.map((s) => (
                      <Sezione key={s.id} s={s} sez={sez} titolo={titoloCapo} onContinua={continua}>{scambi(s.righe)}</Sezione>
                    ))}
                  </div>
                )}
                {sez.attiva ? scambi(sez.attiva.righe) : <p className="nota-piccola sezione-nuova">Nuovo argomento: scrivi qui sotto.</p>}
              </>
            )}
          </>
        )}
      </Stato>

      <div className="scrivi-capo">
        {sez.attiva && (
          <div className="scrivi-sopra">
            <span className="nota-piccola">Continui: {titoloCapo(sez.attiva.righe[0])}</span>
            <button type="button" className="tasto-link" onClick={() => { sez.nuovoArgomento(); vaiInFondo() }}>Nuovo argomento</button>
          </div>
        )}
        <textarea ref={scrivi} value={testo} onChange={(e) => setTesto(e.target.value)} rows={2}
          placeholder={dettatura.attiva ? 'Ti ascolto…' : sez.attiva ? 'Scrivi al Capo…' : 'Nuovo argomento: scrivi al Capo…'} />
        <div className="azioni">
          {dettatura.supportata && (
            <button type="button" className={'tasto-mic' + (dettatura.attiva ? ' attivo' : '')}
              onClick={dettatura.attiva ? dettatura.ferma : dettatura.avvia} aria-label={dettatura.attiva ? 'Ferma la dettatura' : 'Detta'}>
              <Icona nome="mic" />
            </button>
          )}
          <button type="button" className="tasto-grande" onClick={invia} disabled={invio || !testo.trim()}>
            {invio ? 'Invio…' : 'Invia'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Il titolo di una sezione: le parole con cui è cominciata.
function titoloCapo(r) {
  if (r.da === 'ceramex') return `Mail privata: ${r.testo.split('\n').slice(1).join(' ').trim() || r.testo}`
  return r.riordino_id ? `${r.testo.split('\n')[0]} · dal Riordino` : r.testo
}

// Un messaggio di Giovanni con la risposta del capo, le conferme e i lavori passati agli agenti.
function Scambio({ r, conferme, passate, dopo }) {
  return (
    <div className="scambio">
      {/* Mail private passate dall'agente Ceramex (13.10.2026 sera): non sono parole di Giovanni. */}
      {r.da === 'ceramex' ? (
        <p className="fumetto fumetto-segnalazione"><span className="riga-meta">Mail privata nella Gmail · dall'agente Ceramex</span>{r.testo.split('\n').slice(1).join('\n') || r.testo}<span className="ora">{quando(r.creata_il, true)}</span></p>
      ) : (
        /* Dal Riordino: si vedono solo le parole di Giovanni (la prima riga), non i dati della mail per il Capo. */
        <p className="fumetto fumetto-mio">{r.riordino_id ? `${r.testo.split('\n')[0]} · dal Riordino` : r.testo}<span className="ora">{quando(r.creata_il, true)}</span></p>
      )}
      {r.risposta ? (
        <p className="fumetto fumetto-capo">{r.risposta}<span className="ora">{quando(r.risposta_il, true)}</span></p>
      ) : (
        <p className="fumetto fumetto-capo in-attesa">
          {r.stato === 'in_corso' ? 'Ci sto lavorando…' : r.stato === 'avviata' ? 'Arrivo…' : 'In attesa: non sono ancora partito.'}
          {r.errore && <span className="ora rosso">{r.errore}</span>}
        </p>
      )}
      {conferme.map((c) => <Conferma key={c.id} c={c} dopo={dopo} />)}
      {passate.map((p) => (
        <div key={p.id} className="passata">
          <p className="riga-meta">Passata a {NOME_AGENTE[p.agente] || p.agente} · {IN_ATTESA.includes(p.stato) ? 'ci sta lavorando' : p.stato === 'fatta' ? 'fatto' : 'non fatto'}</p>
          {p.risposta && <p>{p.risposta}</p>}
        </div>
      ))}
    </div>
  )
}

// Una cosa rischiosa proposta dal capo: primo tocco "Conferma", secondo tocco "Sì, fallo".
function Conferma({ c, dopo }) {
  const { avvisa } = useApp()
  const due = useDueTocchi()
  const armata = due.armato === 'si'
  const [lavoro, setLavoro] = useState(false)
  const [aperta, setAperta] = useState(false)

  async function decidi(si) {
    setLavoro(true)
    try {
      const ora = new Date().toISOString()
      chk(await sb.from('capo_conferme').update(si ? { stato: 'confermata', confermata_il: ora } : { stato: 'rifiutata', rifiutata_il: ora })
        .eq('id', c.id).eq('stato', 'da_confermare'))
      if (si) {
        const esito = await chiama('agente-subito', { sveglia: 'capo' }).catch(() => ({ ok: false }))
        avvisa(esito.ok || esito.gia ? 'Confermato: il Capo lo fa adesso' : 'Confermato, ma il Capo non è partito: lo fa appena gli scrivi di nuovo')
      } else avvisa('Ok, non lo fa')
      dopo()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
      due.disarma()
    }
  }

  const stato = { confermata: 'Confermata: la sta facendo', rifiutata: 'Non fatta: hai detto di no', fatta: 'Fatto', non_fatta: 'Non riuscita' }[c.stato]
  return (
    <section className={'conferma-capo' + (c.stato === 'da_confermare' ? ' aperta' : '')}>
      <p className="riga-meta">{TIPO[c.tipo] || 'Da confermare'}{stato && ` · ${stato}`}</p>
      <p className="conferma-cosa">{c.cosa}</p>
      {c.dettagli && (aperta || c.stato === 'da_confermare')
        ? <pre className="conferma-dettagli">{c.dettagli}</pre>
        : c.dettagli && <button type="button" className="tasto-link" onClick={() => setAperta(true)}>Vedi il testo</button>}
      {c.esito && <p className="nota-piccola">{c.esito}</p>}
      {c.stato === 'da_confermare' && (
        <div className="azioni">
          <button type="button" className={'tasto-grande' + (armata ? ' armato' : '')} disabled={lavoro}
            onClick={() => due.tocca('si', () => decidi(true))}>
            {lavoro ? 'Un attimo…' : armata ? 'Tocca ancora: sì, fallo' : 'Conferma'}
          </button>
          {/* Anche il No con due tocchi: non si torna indietro. */}
          <button type="button" className={'tasto-link' + (due.armato === 'no' ? ' pericolo-pieno' : '')} disabled={lavoro}
            onClick={() => due.tocca('no', () => decidi(false))}>{due.armato === 'no' ? 'Tocca ancora: non farlo' : 'No'}</button>
        </div>
      )}
    </section>
  )
}

// Modifiche alle app che il capo ha messo da parte per Claude Code (sul PC).
function Modifiche({ righe, dopo }) {
  const { avvisa } = useApp()
  if (!righe.length) return null
  async function cambia(m, valori, testo, prima) {
    try {
      chk(await sb.from('modifiche_claude').update(valori).eq('id', m.id))
      avvisa(testo, { etichetta: 'Annulla', fai: async () => { await sb.from('modifiche_claude').update(prima).eq('id', m.id); dopo() } })
      dopo()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }
  const STATO = { proposta: 'aspetta il tuo ok', ok: 'ok dato: la faccio sul PC', fatta: 'fatta', scartata: 'scartata' }
  return (
    <>
      <h3>Cambi alle app</h3>
      <p className="nota-piccola">Cambi alle app che il Capo non può fare da solo: con il tuo ok li fa Claude sul PC.</p>
      <div className="elenco">
        {righe.map((m) => (
          <section key={m.id} className="modifica-claude">
            <p className="riga-meta">{APP[m.app]} · {quando(m.creata_il, true)} · {STATO[m.stato]}</p>
            <p className="richiesta-testo">{m.titolo}</p>
            <p className="nota-piccola">{m.testo}</p>
            {m.nota_claude && <p className="richiesta-risposta">{m.nota_claude}</p>}
            {m.stato === 'proposta' && (
              <div className="azioni">
                <button type="button" className="tasto-grande" onClick={() => cambia(m, { stato: 'ok', ok_il: new Date().toISOString() }, 'Ok dato', { stato: 'proposta', ok_il: null })}>Ok, falla</button>
                <button type="button" className="tasto-link" onClick={() => cambia(m, { stato: 'scartata', scartata_il: new Date().toISOString() }, 'Scartata', { stato: 'proposta', scartata_il: null })}>No</button>
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  )
}
