import { useState } from 'react'
import { sb, areaDa, quando } from './supabase'
import { useApp, useCarica, chk, chiama, messaggioErrore, Stato, Indietro, useModifiche, LinguetteCapo } from './componenti'

// Domande per Giovanni: i dubbi degli agenti. Un tocco su una risposta pronta, o due parole scritte.
// L'agente legge la risposta al giro dopo (entro un'ora) e la usa. Per le domande di lavoro, appena rispondi parte anche lo
// smistatore: se la risposta chiede cose che spettano ad altri agenti, le passa a loro (12.10.2026).
export function Domande() {
  const { area, avvisa } = useApp()
  const [scritte, setScritte] = useState({})
  useModifiche(Object.values(scritte).some((s) => s?.trim()))

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    let q = sb.from('domande')
      .select('id,area,agente,testo,scelte,creata_il,note(id,testo),persone(id,nome,cognome),aziende(id,nome)')
      .is('risposta_il', null).or(`mostra_dal.is.null,mostra_dal.lte.${new Date().toISOString()}`).order('creata_il')
    if (area !== 'T') q = q.or(`area.eq.${area},area.is.null`)
    // Quelle che lo smistatore ha passato a un altro agente negli ultimi 3 giorni (solo lavoro).
    let qs = sb.from('domande').select('id,area,testo,risposta,smistata_nota,smistata_il')
      .not('smistata_nota', 'is', null).gte('smistata_il', new Date(Date.now() - 3 * 86400e3).toISOString())
      .not('smistata_nota', 'ilike', 'niente%').order('smistata_il', { ascending: false })
    if (area !== 'T') qs = qs.eq('area', area)
    const [aperte, passate] = await Promise.all([q.then(chk), qs.then(chk)])
    return { aperte, passate }
  }, [area])

  async function rispondi(d, risposta) {
    if (!risposta?.trim()) return avvisa('Scrivi la risposta')
    try {
      chk(await sb.from('domande').update({ risposta: risposta.trim(), risposta_il: new Date().toISOString() }).eq('id', d.id))
      setScritte((s) => ({ ...s, [d.id]: '' }))
      avvisa('Grazie: l\'agente la usa la prossima volta che lavora (entro un\'ora)')
      // Lavoro (non Privato): sveglia lo smistatore, che passa subito agli altri agenti quello che serve.
      if (d.area !== 'P' && d.agente !== 'privato') chiama('agente-subito', { sveglia: 'smistatore' }).catch(() => {})
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  return (
    <div className="schermata">
      <Indietro titolo="Domande per te" />
      <LinguetteCapo attiva="domande" />
      <Stato carica={carica} errore={errore} vuoto={dati && !dati.aperte.length && !dati.passate.length ? 'Nessuna domanda. Gli agenti hanno capito tutto.' : null}>
        {dati && (
          <>
          <div className="domande">
            {dati.aperte.map((d) => {
              const a = areaDa(d.area)
              return (
                <section key={d.id} className="domanda" style={{ '--c': a?.colore || 'var(--grigio)' }}>
                  <p className="riga-meta">{a ? a.nome : 'Da smistare'} · {quando(d.creata_il, true)}</p>
                  <p className="domanda-testo">{d.testo}</p>
                  {(d.note || d.persone || d.aziende) && (
                    <p className="nota-piccola">
                      {d.note && <a href={`#/nota/${d.note.id}`}>«{d.note.testo.slice(0, 80)}{d.note.testo.length > 80 ? '…' : ''}»</a>}
                      {d.persone && <> <a href={`#/persona/${d.persone.id}`}>{[d.persone.nome, d.persone.cognome].filter(Boolean).join(' ')}</a></>}
                      {d.aziende && <> <a href={`#/azienda/${d.aziende.id}`}>{d.aziende.nome}</a></>}
                    </p>
                  )}
                  {d.scelte?.length > 0 && (
                    <div className="chips">
                      {d.scelte.map((s) => (
                        <button key={s} type="button" className="chip" onClick={() => rispondi(d, s)}>{s}</button>
                      ))}
                    </div>
                  )}
                  <form className="riga-campo" onSubmit={(e) => { e.preventDefault(); rispondi(d, scritte[d.id]) }}>
                    <input type="text" value={scritte[d.id] || ''} placeholder="Oppure scrivi…" enterKeyHint="send"
                      onChange={(e) => setScritte({ ...scritte, [d.id]: e.target.value })} />
                    <button type="submit" className="tasto-piccolo">Rispondi</button>
                  </form>
                </section>
              )
            })}
          </div>
          {dati.passate.length > 0 && (
            <>
              <h2>Passate a un altro agente</h2>
              <p className="nota-piccola">Risposte tue che riguardavano un altro agente: gliele ho passate io (ultimi 3 giorni). Vedi com'è andata in Agenti.</p>
              <div className="elenco">
                {dati.passate.map((d) => (
                  <a key={d.id} className="riga" href="#/agenti">
                    <span className="riga-corpo">
                      <span className="riga-testo">{d.testo}</span>
                      <span className="riga-meta">→ {d.smistata_nota} · {quando(d.smistata_il, true)}</span>
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
          </>
        )}
      </Stato>
    </div>
  )
}
