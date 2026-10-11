import { sb, AREE, areaDa, nomePersona, giorniDaOggi, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, NotaRiga, Stato, Indietro, Icona, aggiungiAreaPersone } from './componenti'

const CAMPI_NOTA = 'id,area,testo,fonte,creata_il,note_persone(persone(id,nome,cognome)),allegati(id)'

// Il cassetto "Dentro": tutto quello che non sta nei 3 tasti.
export function Dentro({ inbox }) {
  async function esci() {
    scrivi('impronta-rimandata', '')
    await sb.auth.signOut()
  }
  return (
    <div className="schermata">
      <h1>Dentro</h1>
      <div className="elenco">
        <Voce href="#/inbox" titolo="Inbox" dettaglio={inbox ? `${inbox} da smistare` : 'vuota'} />
        <Voce href="#/aziende" titolo="Aziende" dettaglio="Schede clienti con le note" />
        <Voce href="#/bozze" titolo="Bozze G&C" dettaglio="Risposte da approvare per info@" />
        <Voce href="#/persone" titolo="Persone" dettaglio="Schede persona: chi è, cosa chiedere, note e contatti" />
        <Voce href="#/domande" titolo="Domande per te" dettaglio="I dubbi degli agenti" />
        <Voce href="#/note" titolo="Tutte le note" />
        <Voce href="#/cestino" titolo="Cestino" dettaglio="30 giorni" />
      </div>
      <button type="button" className="tasto-link esci" onClick={esci}>Esci</button>
    </div>
  )
}

function Voce({ href, titolo, dettaglio }) {
  return (
    <a className="riga voce" href={href}>
      <span className="riga-corpo">
        <span className="riga-testo">{titolo}</span>
        {dettaglio && <span className="riga-meta">{dettaglio}</span>}
      </span>
      <Icona nome="freccia" size={18} />
    </a>
  )
}

// Inbox: un tocco sul colore e la nota va nella sua area.
export function Inbox() {
  const { avvisa } = useApp()
  const { dati, errore, carica, ricarica } = useCarica(async () => chk(
    await sb.from('note').select(CAMPI_NOTA).is('area', null).is('eliminata_il', null)
      .order('creata_il', { ascending: false }),
  ), [])

  async function smista(nota, area) {
    try {
      chk(await sb.from('note').update({ area }).eq('id', nota.id))
      await aggiungiAreaPersone(area, nota.note_persone.map((np) => np.persone?.id).filter(Boolean))
      avvisa(`Spostata in ${areaDa(area).nome}`)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  return (
    <div className="schermata">
      <Indietro titolo="Inbox" />
      <Stato carica={carica} errore={errore} vuoto={dati?.length === 0 ? 'Inbox vuota. Tutto smistato.' : null}>
        {dati && (
          <div className="elenco">
            {dati.map((n) => (
              <div key={n.id} className="riga-inbox">
                <NotaRiga nota={n} />
                <div className="smista">
                  {AREE.map((a) => (
                    <button key={a.codice} type="button" style={{ '--c': a.colore }}
                      className="chip chip-area" onClick={() => smista(n, a.codice)}>
                      {a.nome}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Stato>
    </div>
  )
}

export function ElencoNote() {
  const { area } = useApp()
  const { dati, errore, carica } = useCarica(async () => {
    // Le note dei clienti si guardano nelle schede delle aziende.
    let q = sb.from('note').select(CAMPI_NOTA).is('eliminata_il', null).is('azienda_id', null)
      .order('creata_il', { ascending: false }).limit(200)
    if (area !== 'T') q = q.eq('area', area)
    return chk(await q)
  }, [area])

  return (
    <div className="schermata">
      <Indietro titolo={area === 'T' ? 'Tutte le note' : `Note ${areaDa(area).nome}`} />
      <Stato carica={carica} errore={errore} vuoto={dati?.length === 0 ? 'Nessuna nota.' : null}>
        {dati && <div className="elenco">{dati.map((n) => <NotaRiga key={n.id} nota={n} />)}</div>}
      </Stato>
    </div>
  )
}

const restano = (iso) => Math.max(0, 30 + giorniDaOggi(iso))

export function Cestino() {
  const { avvisa } = useApp()
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [note, persone, promemoria] = await Promise.all([
      sb.from('note').select('id,testo,area,eliminata_il').not('eliminata_il', 'is', null).order('eliminata_il', { ascending: false }),
      sb.from('persone').select('id,nome,cognome,eliminata_il').not('eliminata_il', 'is', null).order('eliminata_il', { ascending: false }),
      sb.from('promemoria').select('id,testo,area,eliminata_il').not('eliminata_il', 'is', null).order('eliminata_il', { ascending: false }),
    ])
    return [
      ...chk(note).map((x) => ({ ...x, tabella: 'note', titolo: x.testo || 'Foto', tipo: 'Nota' })),
      ...chk(persone).map((x) => ({ ...x, tabella: 'persone', titolo: nomePersona(x), tipo: 'Persona' })),
      ...chk(promemoria).map((x) => ({ ...x, tabella: 'promemoria', titolo: x.testo, tipo: 'Promemoria' })),
    ].sort((a, b) => b.eliminata_il.localeCompare(a.eliminata_il))
  }, [])

  async function ripristina(v) {
    try {
      chk(await sb.from(v.tabella).update({ eliminata_il: null }).eq('id', v.id))
      avvisa('Ripristinato')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  return (
    <div className="schermata">
      <Indietro titolo="Cestino" />
      <p className="nota-piccola">Quello che butti resta qui 30 giorni, poi si cancella da solo.</p>
      <Stato carica={carica} errore={errore} vuoto={dati?.length === 0 ? 'Cestino vuoto.' : null}>
        {dati && (
          <div className="elenco">
            {dati.map((v) => (
              <div key={v.tabella + v.id} className="riga">
                <span className="pallino" style={{ background: areaDa(v.area)?.colore || 'var(--grigio)' }} />
                <span className="riga-corpo">
                  <span className="riga-testo">{v.titolo}</span>
                  <span className="riga-meta">{v.tipo} · ancora {restano(v.eliminata_il)} giorni</span>
                </span>
                <button type="button" className="tasto-piccolo" onClick={() => ripristina(v)}>Ripristina</button>
              </div>
            ))}
          </div>
        )}
      </Stato>
    </div>
  )
}
