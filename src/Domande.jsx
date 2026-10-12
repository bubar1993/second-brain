import { useState } from 'react'
import { sb, areaDa, quando } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro, useModifiche } from './componenti'

// Domande per Giovanni: i dubbi degli agenti. Un tocco su una risposta pronta, o due parole scritte.
// L'agente legge la risposta al giro dopo (entro un'ora) e la usa.
export function Domande() {
  const { area, avvisa } = useApp()
  const [scritte, setScritte] = useState({})
  useModifiche(Object.values(scritte).some((s) => s?.trim()))

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    let q = sb.from('domande')
      .select('id,area,agente,testo,scelte,creata_il,note(id,testo),persone(id,nome,cognome),aziende(id,nome)')
      .is('risposta_il', null).or(`mostra_dal.is.null,mostra_dal.lte.${new Date().toISOString()}`).order('creata_il')
    if (area !== 'T') q = q.or(`area.eq.${area},area.is.null`)
    return chk(await q)
  }, [area])

  async function rispondi(d, risposta) {
    if (!risposta?.trim()) return avvisa('Scrivi la risposta')
    try {
      chk(await sb.from('domande').update({ risposta: risposta.trim(), risposta_il: new Date().toISOString() }).eq('id', d.id))
      setScritte((s) => ({ ...s, [d.id]: '' }))
      avvisa('Grazie: l\'agente la usa al prossimo giro')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  return (
    <div className="schermata">
      <Indietro titolo="Domande per te" />
      <Stato carica={carica} errore={errore} vuoto={dati?.length === 0 ? 'Nessuna domanda. Gli agenti hanno capito tutto.' : null}>
        {dati && (
          <div className="domande">
            {dati.map((d) => {
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
        )}
      </Stato>
    </div>
  )
}
