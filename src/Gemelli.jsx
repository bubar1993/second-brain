import { useState } from 'react'
import { sb } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, NotaRiga, Stato, Indietro } from './componenti'

// Gemelli (Privato): la settimana, le feste dei compagni, gli orari fissi e il diario.
// Niente moduli: le cose nuove si scrivono col + ("Leo festa di Elodi sabato alle 16:30") e le mette a posto l'agente privato.
const GIORNI = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
const PAROLE = ['leo', 'leonardo', 'jolie', 'jojo', 'gemelli', 'bimbi', 'scuola', 'pianoforte', 'piano', 'calcio', 'tennis', 'gym', 'atletica', 'fashion']
const ora = (t) => (t ? t.slice(0, 5) : '')
const oraDa = (iso) => new Date(iso).toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })
const giornoIso = (d) => (d.getDay() + 6) % 7 + 1 // 1 = lunedì
const stessoGiorno = (a, b) => a.toDateString() === b.toDateString()

export function Gemelli() {
  const { avvisa, vai } = useApp()
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const da = new Date(); da.setHours(0, 0, 0, 0)
    const a8 = new Date(da.getTime() + 8 * 864e5)
    const [figli, attivita, feste, eventi] = await Promise.all([
      sb.from('persone').select('id,nome,compleanno').in('ruolo', ['figlio', 'figlia']).is('eliminata_il', null).order('nome'),
      sb.from('attivita_figli').select('*').eq('attiva', true).order('giorno', { nullsFirst: false }).order('inizio'),
      sb.from('feste').select('*').or(`inizio.gte.${new Date(da.getTime() - 864e5).toISOString()},inizio.is.null`).order('inizio', { nullsFirst: false }),
      sb.from('eventi').select('id,titolo,inizio,fine,tutto_il_giorno,luogo').eq('area', 'P').in('stato', ['confermato', 'da_creare'])
        .is('fatto_il', null).gte('inizio', da.toISOString()).lt('inizio', a8.toISOString()).order('inizio'),
    ])
    const ff = chk(figli)
    const legami = ff.length ? chk(await sb.from('note_persone')
      .select('persona_id,note(id,area,testo,fonte,creata_il,eliminata_il,note_persone(persone(id,nome,cognome)),allegati(id))')
      .in('persona_id', ff.map((f) => f.id))) : []
    const viste = new Set()
    const diario = legami.map((l) => l.note).filter((n) => n && !n.eliminata_il && !viste.has(n.id) && viste.add(n.id))
      .sort((a, b) => b.creata_il.localeCompare(a.creata_il)).slice(0, 15)
    const fe = chk(feste)
    const legateAFeste = new Set(fe.map((f) => f.evento_id).filter(Boolean))
    // Dal calendario: solo gli appuntamenti che parlano dei bambini o delle loro attività.
    const ev = chk(eventi).filter((e) => legateAFeste.has(e.id) || PAROLE.some((p) => new RegExp(`\\b${p}`, 'i').test(e.titolo)))
    return { figli: ff, attivita: chk(attivita), feste: fe, eventi: ev, diario }
  }, [])

  async function cambiaFesta(f, campi, messaggio) {
    try {
      chk(await sb.from('feste').update({ ...campi, modificata_il: new Date().toISOString() }).eq('id', f.id))
      avvisa(messaggio)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  const nomi = (ids) => (dati?.figli || []).filter((f) => ids?.includes(f.id)).map((f) => (f.nome === 'Leonardo' ? 'Leo' : f.nome)).join(' e ')
  const eta = (f) => {
    if (!f.compleanno) return ''
    const n = new Date(f.compleanno); const o = new Date()
    return o.getFullYear() - n.getFullYear() - (o < new Date(o.getFullYear(), n.getMonth(), n.getDate()) ? 1 : 0)
  }

  // I prossimi 7 giorni: attività fisse di quel giorno + appuntamenti + feste.
  const giorni = []
  if (dati) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i)
      const righe = [
        ...dati.attivita.filter((a) => a.giorno === giornoIso(d))
          .map((a) => ({ k: 'a' + a.id, ora: ora(a.inizio), testo: `${a.nome}${a.fine ? ` (fino alle ${ora(a.fine)})` : ''}`, chi: nomi(a.persone), extra: a.accompagna })),
        ...dati.eventi.filter((e) => stessoGiorno(new Date(e.inizio), d) && !dati.feste.some((f) => f.evento_id === e.id))
          .map((e) => ({ k: 'e' + e.id, ora: e.tutto_il_giorno ? '' : oraDa(e.inizio), testo: e.titolo, extra: e.luogo })),
        ...dati.feste.filter((f) => f.inizio && stessoGiorno(new Date(f.inizio), d))
          .map((f) => ({ k: 'f' + f.id, ora: oraDa(f.inizio), testo: `Festa di ${f.festeggiato}`, chi: nomi(f.persone), extra: f.luogo })),
      ].sort((a, b) => (a.ora || '99').localeCompare(b.ora || '99'))
      if (righe.length) giorni.push({ d, righe })
    }
  }
  const senzaOrario = dati?.attivita.filter((a) => !a.giorno) || []

  return (
    <div className="schermata gemelli">
      <Indietro titolo="Gemelli" />
      <Stato carica={carica} errore={errore}>
        {dati && (
          <>
            <p className="nota-piccola">
              {dati.figli.map((f) => `${f.nome}${eta(f) ? ` (${eta(f)} anni)` : ''}`).join(' e ')} · terza elementare
            </p>
            <div className="contatti-persona">
              {dati.figli.map((f) => (
                <button key={f.id} type="button" className="tasto-piccolo" onClick={() => vai(`/aggiungi?persona=${f.id}`)}>+ {f.nome === 'Leonardo' ? 'Leo' : f.nome}</button>
              ))}
            </div>

            <h2>Questa settimana</h2>
            {giorni.length === 0 && <p className="msg">Niente in programma nei prossimi 7 giorni.</p>}
            {giorni.map(({ d, righe }) => (
              <section key={d.toISOString()} className="gemelli-giorno">
                <h3>{stessoGiorno(d, new Date()) ? 'Oggi' : d.toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
                <div className="elenco">
                  {righe.map((r) => (
                    <div key={r.k} className="riga">
                      <span className="riga-corpo">
                        <span className="riga-testo">{r.ora && <b>{r.ora} </b>}{r.testo}</span>
                        <span className="riga-meta">{[r.chi, r.extra].filter(Boolean).join(' · ')}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <h2>Feste dei compagni</h2>
            {dati.feste.length === 0 && <p className="msg">Nessuna festa in vista. Quando arriva un invito scrivilo col +.</p>}
            <div className="elenco">
              {dati.feste.map((f) => (
                <div key={f.id} className="riga festa">
                  <span className="riga-corpo">
                    <span className="riga-testo">Festa di {f.festeggiato}{f.persone?.length ? ` · ${nomi(f.persone)}` : ''}</span>
                    <span className="riga-meta">
                      {f.inizio ? new Date(f.inizio).toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'short' }) + ' ' + oraDa(f.inizio) : 'data da sapere'}
                      {f.luogo ? ` · ${f.luogo}` : ''}{f.idea_regalo ? ` · idea regalo: ${f.idea_regalo}` : ''}
                    </span>
                    <span className="festa-tasti">
                      {f.risposta === 'da_dare' ? (
                        <>
                          <span className="rosso">Rispondere all'invito:</span>
                          <button type="button" className="tasto-piccolo" onClick={() => cambiaFesta(f, { risposta: 'si' }, 'Segnato: ci va')}>Ci va</button>
                          <button type="button" className="tasto-link" onClick={() => cambiaFesta(f, { risposta: 'no', regalo: 'non_serve' }, 'Segnato: non ci va')}>Non ci va</button>
                        </>
                      ) : (
                        <span>{f.risposta === 'si' ? 'Risposto: ci va' : 'Risposto: non ci va'}</span>
                      )}
                      {f.risposta !== 'no' && (f.regalo === 'da_prendere'
                        ? <button type="button" className="tasto-piccolo" onClick={() => cambiaFesta(f, { regalo: 'preso' }, 'Regalo preso')}>Regalo preso</button>
                        : f.regalo === 'preso' && <span>· regalo preso ✓</span>)}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <h2>Attività fisse</h2>
            <div className="elenco">
              {dati.attivita.filter((a) => a.giorno).map((a) => (
                <div key={a.id} className="riga">
                  <span className="riga-corpo">
                    <span className="riga-testo">{a.nome} · {nomi(a.persone)}</span>
                    <span className="riga-meta">{GIORNI[a.giorno]} {ora(a.inizio)}{a.fine ? `–${ora(a.fine)}` : ''}{a.luogo ? ` · ${a.luogo}` : ''}{a.accompagna ? ` · ${a.accompagna}` : ''}</span>
                  </span>
                </div>
              ))}
              {senzaOrario.length > 0 && (
                <div className="riga">
                  <span className="riga-corpo">
                    <span className="riga-testo">Orario da sapere: {senzaOrario.map((a) => `${a.nome} (${nomi(a.persone)})`).join(', ')}</span>
                    <span className="riga-meta">Rispondi alla domanda in "Domande per te" o scrivilo col +</span>
                  </span>
                </div>
              )}
            </div>

            <h2>Diario</h2>
            {dati.diario.length === 0
              ? <p className="msg">Ancora niente. Tocca "+ Leo" o "+ Jolie" per scrivere qualcosa su di loro.</p>
              : <div className="elenco">{dati.diario.map((n) => <NotaRiga key={n.id} nota={n} />)}</div>}
          </>
        )}
      </Stato>
    </div>
  )
}
