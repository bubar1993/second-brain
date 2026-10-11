import { useEffect, useState } from 'react'
import { sb, areaDa, nomePersona } from './supabase'
import { useApp, chk, messaggioErrore, NotaRiga, Icona } from './componenti'
import { iniziali, battesimo } from './Aziende'

const pulisci = (s) => s.replace(/[,()%*\\.:]/g, '')

// Fase 1: cerca le parole nelle note e nelle persone. L'intelligenza arriva nella fase 4.
export default function Chiedi() {
  const { area } = useApp()
  const [domanda, setDomanda] = useState('')
  const [risultati, setRisultati] = useState(null)
  const [msg, setMsg] = useState('')
  const [lavoro, setLavoro] = useState(false)

  // I clienti sono pochi: si leggono una volta e si filtrano mentre scrivi.
  const [aziende, setAziende] = useState([])
  useEffect(() => {
    sb.from('aziende').select('id,nome,area,ragione_sociale,email,contatti,gruppo:gruppo_id(nome)')
      .is('eliminata_il', null).is('unito_in', null).order('nome')
      .then(({ data }) => setAziende(data || []))
  }, [])
  const testo = domanda.trim().toLowerCase()
  const clienti = testo.length < 2 ? [] : aziende
    .filter((a) => area === 'T' || a.area === area)
    .filter((a) => [a.nome, a.ragione_sociale, ...(a.email || []), ...(a.contatti || []).map((c) => c.nome)]
      .some((s) => s && s.toLowerCase().includes(testo)))
    // Prima chi ha il nome che comincia così.
    .sort((x, y) => y.nome.toLowerCase().startsWith(testo) - x.nome.toLowerCase().startsWith(testo))
    .slice(0, 6)

  async function cerca(e) {
    e.preventDefault()
    const parole = domanda.trim().split(/\s+/).map(pulisci).filter(Boolean)
    if (!parole.length) return
    setLavoro(true)
    setMsg('')
    try {
      let qn = sb.from('note').select('id,area,testo,fonte,creata_il,note_persone(persone(id,nome,cognome)),allegati(id)')
        .is('eliminata_il', null).order('creata_il', { ascending: false }).limit(30)
      let qp = sb.from('persone').select('id,nome,cognome,persone_aree(area)')
        .is('eliminata_il', null).order('nome').limit(10)
      for (const p of parole) {
        qn = qn.ilike('testo', `%${p}%`)
        qp = qp.or(`nome.ilike.%${p}%,cognome.ilike.%${p}%`)
      }
      if (area !== 'T') qn = qn.eq('area', area)
      const [note, persone] = await Promise.all([qn, qp])
      let pers = chk(persone)
      if (area !== 'T') pers = pers.filter((p) => p.persone_aree.some((x) => x.area === area))
      setRisultati({ note: chk(note), persone: pers })
    } catch (e) {
      setMsg(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  const vuoto = risultati && !risultati.note.length && !risultati.persone.length && !clienti.length

  return (
    <div className="schermata">
      <form className="cerca" onSubmit={cerca}>
        <input type="search" value={domanda} onChange={(e) => setDomanda(e.target.value)}
          placeholder="Cerca clienti, note e persone" enterKeyHint="search" autoFocus />
        <button type="submit" className="tasto-pieno" disabled={lavoro} aria-label="Cerca">
          <Icona nome="cerca" />
        </button>
      </form>
      <p className="nota-piccola">
        Per ora cerca le parole esatte{area !== 'T' ? ` in ${areaDa(area).nome}` : ''}. Le risposte vere arrivano nella fase 4.
      </p>

      {clienti.length > 0 && (
        <>
          <h2>Clienti</h2>
          <div className="elenco">
            {clienti.map((a) => {
              const persone = (a.contatti || []).map((c) => battesimo(c.nome)).filter(Boolean)
              return (
                <a key={a.id} className="riga riga-azienda" href={`#/azienda/${a.id}`}>
                  <span className="iniziali" aria-hidden="true">{iniziali(a.nome)}</span>
                  <span className="riga-corpo">
                    <span className="riga-testo">{a.nome}</span>
                    <span className="riga-meta">
                      {a.gruppo ? `Filiale di ${a.gruppo.nome}` : persone.slice(0, 3).join(', ') + (persone.length > 3 ? '…' : '')}
                    </span>
                  </span>
                  <Icona nome="freccia" size={18} />
                </a>
              )
            })}
          </div>
        </>
      )}

      {msg && <p className="msg errore">{msg}</p>}
      {vuoto && <p className="msg">Non ho trovato niente.</p>}

      {risultati?.persone.length > 0 && (
        <>
          <h2>Persone</h2>
          <div className="elenco">
            {risultati.persone.map((p) => (
              <a key={p.id} className="riga" href={`#/persona/${p.id}`}>
                <span className="pallini">
                  {p.persone_aree.map((x) => (
                    <span key={x.area} className="pallino" style={{ background: areaDa(x.area).colore }} />
                  ))}
                </span>
                <span className="riga-corpo"><span className="riga-testo">{nomePersona(p)}</span></span>
              </a>
            ))}
          </div>
        </>
      )}

      {risultati?.note.length > 0 && (
        <>
          <h2>Note</h2>
          <div className="elenco">{risultati.note.map((n) => <NotaRiga key={n.id} nota={n} />)}</div>
        </>
      )}
    </div>
  )
}
