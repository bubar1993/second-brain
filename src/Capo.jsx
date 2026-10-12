import { useEffect, useRef, useState } from 'react'
import { sb, quando } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Icona, useModifiche, useDettatura } from './componenti'
import { AGENTI } from './Agenti'

// Agente capo (13.10.2026, tasto "Capo" in basso accanto a Chiedi): Giovanni scrive o detta, il capo risponde qui.
// Le richieste stanno in richieste_agenti (agente = 'capo'); sotto ogni risposta: le cose da confermare con due tocchi
// (capo_conferme) e i lavori passati agli altri agenti (richieste con da = 'capo' e origine_id).
// In fondo le "Modifiche per Claude Code" (modifiche_claude): le fa Claude sul PC solo con l'ok di Giovanni.

const IN_ATTESA = ['nuova', 'avviata', 'in_corso']
const NOME_AGENTE = Object.fromEntries(AGENTI.map((a) => [a.codice, a.nome]))
const TIPO = { mail: 'Mail', messaggio: 'Messaggio', cancella: 'Cancellare', gestionale: 'Gestionale', sposta_mail: 'Spostare mail', altro: 'Da confermare' }
const APP = { brain: 'Brain', ceramex: 'App Ceramex', gc: 'App G&C' }

// Badge del tasto Capo: cose da confermare + risposte del capo non lette.
export async function contaCapo() {
  const [c, r] = await Promise.all([
    sb.from('capo_conferme').select('id', { count: 'exact', head: true }).eq('stato', 'da_confermare'),
    sb.from('richieste_agenti').select('id', { count: 'exact', head: true }).eq('agente', 'capo').not('risposta_il', 'is', null).is('vista_il', null),
  ])
  return (c.count || 0) + (r.count || 0)
}

export function Capo() {
  const { avvisa } = useApp()
  const [testo, setTesto] = useState('')
  const [invio, setInvio] = useState(false)
  const fondo = useRef(null)
  const primoGiro = useRef(true)
  useModifiche(!!testo.trim())
  const dettatura = useDettatura((t) => setTesto((v) => (v.trim() ? `${v.trim()} ${t}` : t)))

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const richieste = chk(await sb.from('richieste_agenti').select('*').eq('agente', 'capo')
      .order('creata_il', { ascending: false }).limit(30)).reverse()
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

  // Si apre in fondo, sull'ultimo messaggio.
  useEffect(() => {
    if (!dati || !primoGiro.current) return
    primoGiro.current = false
    requestAnimationFrame(() => fondo.current?.scrollIntoView({ block: 'end' }))
  }, [dati])

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
      const r = chk(await sb.from('richieste_agenti').insert({ agente: 'capo', testo: t }).select('id').single())
      setTesto('')
      const esito = await chiama('agente-subito', { id: r.id }).catch((e) => ({ ok: false, errore: messaggioErrore(e) }))
      avvisa(esito.ok ? 'Il Capo ci pensa: risponde tra 1–2 minuti'
        : esito.motivo === 'senza_pulsante' ? 'Il Capo risponde al prossimo giro (entro un\'ora)'
          : 'Non è partito subito: risponde al prossimo giro')
      await ricarica()
      requestAnimationFrame(() => fondo.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }))
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setInvio(false)
    }
  }

  const conferme = (id) => dati.conferme.filter((c) => c.richiesta_id === id)
  const passate = (id) => dati.passate.filter((p) => p.origine_id === id)
  const senzaRichiesta = dati ? dati.conferme.filter((c) => c.stato === 'da_confermare' && !dati.richieste.some((r) => r.id === c.richiesta_id)) : []

  return (
    <div className="schermata capo">
      <div className="testata"><h1>Capo</h1></div>
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
              <div className="chat-capo">
                {dati.richieste.map((r) => (
                  <div key={r.id} className="scambio">
                    <p className="fumetto fumetto-mio">{r.testo}<span className="ora">{quando(r.creata_il, true)}</span></p>
                    {r.risposta ? (
                      <p className="fumetto fumetto-capo">{r.risposta}<span className="ora">{quando(r.risposta_il, true)}</span></p>
                    ) : (
                      <p className="fumetto fumetto-capo in-attesa">
                        {r.stato === 'in_corso' ? 'Ci sto lavorando…' : r.stato === 'avviata' ? 'Arrivo…' : 'Lo leggo al prossimo giro.'}
                        {r.errore && <span className="ora rosso">{r.errore}</span>}
                      </p>
                    )}
                    {conferme(r.id).map((c) => <Conferma key={c.id} c={c} dopo={ricarica} />)}
                    {passate(r.id).map((p) => (
                      <div key={p.id} className="passata">
                        <p className="riga-meta">Passata a {NOME_AGENTE[p.agente] || p.agente} · {IN_ATTESA.includes(p.stato) ? 'ci sta lavorando' : p.stato === 'fatta' ? 'fatto' : 'non fatto'}</p>
                        {p.risposta && <p>{p.risposta}</p>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Stato>

      <div className="scrivi-capo" ref={fondo}>
        <textarea value={testo} onChange={(e) => setTesto(e.target.value)} rows={2}
          placeholder={dettatura.attiva ? 'Ti ascolto…' : 'Scrivi al Capo…'} />
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

// Una cosa rischiosa proposta dal capo: primo tocco "Conferma", secondo tocco "Sì, fallo".
function Conferma({ c, dopo }) {
  const { avvisa } = useApp()
  const [armata, setArmata] = useState(false)
  const [lavoro, setLavoro] = useState(false)
  const [aperta, setAperta] = useState(false)
  useEffect(() => {
    if (!armata) return
    const t = setTimeout(() => setArmata(false), 5000)
    return () => clearTimeout(t)
  }, [armata])

  async function decidi(si) {
    setLavoro(true)
    try {
      const ora = new Date().toISOString()
      chk(await sb.from('capo_conferme').update(si ? { stato: 'confermata', confermata_il: ora } : { stato: 'rifiutata', rifiutata_il: ora })
        .eq('id', c.id).eq('stato', 'da_confermare'))
      if (si) {
        const esito = await chiama('agente-subito', { sveglia: 'capo' }).catch(() => ({ ok: false }))
        avvisa(esito.ok || esito.gia ? 'Confermato: il Capo lo fa adesso' : 'Confermato: il Capo lo fa al prossimo giro')
      } else avvisa('Ok, non lo fa')
      dopo()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
      setArmata(false)
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
            onClick={() => (armata ? decidi(true) : setArmata(true))}>
            {lavoro ? 'Un attimo…' : armata ? 'Sì, fallo' : 'Conferma'}
          </button>
          <button type="button" className="tasto-link" disabled={lavoro} onClick={() => decidi(false)}>No</button>
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
      <h3>Modifiche per Claude Code</h3>
      <p className="nota-piccola">Cambi alle app che il Capo non può fare da solo: con il tuo ok li fa Claude Code sul PC.</p>
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
