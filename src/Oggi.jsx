import { useEffect, useState } from 'react'
import { sb, areaDa, quando, giorniDaOggi, leggi, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, NotaRiga, Stato, Icona } from './componenti'

export default function Oggi({ inbox }) {
  const { area, avvisa } = useApp()

  const { dati, errore, carica, ricarica } = useCarica(async () => {
    let qp = sb.from('promemoria').select('id,testo,area,scade_il,urgente,nota_id')
      .is('fatto_il', null).is('eliminata_il', null)
      .order('scade_il', { ascending: true, nullsFirst: false }).limit(50)
    let qn = sb.from('note').select('id,area,testo,fonte,creata_il,note_persone(persone(id,nome,cognome)),allegati(id)')
      .is('eliminata_il', null).not('area', 'is', null)
      .order('creata_il', { ascending: false }).limit(5)
    if (area !== 'T') {
      qp = qp.or(`area.eq.${area},area.is.null`)
      qn = qn.eq('area', area)
    }
    const [promemoria, note] = await Promise.all([qp, qn])
    return { promemoria: chk(promemoria), note: chk(note) }
  }, [area])

  async function fatto(id) {
    try {
      chk(await sb.from('promemoria').update({ fatto_il: new Date().toISOString() }).eq('id', id))
      avvisa('Fatto')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  const gruppi = { ritardo: [], oggi: [], prossimi: [], senzaData: [] }
  for (const p of dati?.promemoria || []) {
    if (!p.scade_il) gruppi.senzaData.push(p)
    else if (new Date(p.scade_il) < new Date()) gruppi.ritardo.push(p)
    else if (giorniDaOggi(p.scade_il) === 0) gruppi.oggi.push(p)
    else gruppi.prossimi.push(p)
  }
  const nessunPromemoria = dati && dati.promemoria.length === 0

  const data = new Date().toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'long' })
  const titolo = data.charAt(0).toUpperCase() + data.slice(1)

  return (
    <div className="schermata">
      <h1 className="data-oggi">{titolo}</h1>

      <AttivaImpronta />
      <AvvisoBackup />

      {inbox > 0 && (
        <a className="scheda scheda-inbox" href="#/inbox">
          <span><strong>{inbox}</strong> {inbox === 1 ? 'cosa' : 'cose'} nell'Inbox da smistare</span>
          <Icona nome="freccia" size={18} />
        </a>
      )}

      <h2>Promemoria</h2>
      <Stato carica={carica} errore={errore} vuoto={nessunPromemoria ? 'Niente in sospeso.' : null}>
        {dati && (
          <>
            <Gruppo titolo="In ritardo" righe={gruppi.ritardo} fatto={fatto} ritardo />
            <Gruppo titolo="Oggi" righe={gruppi.oggi} fatto={fatto} />
            <Gruppo titolo="Prossimi giorni" righe={gruppi.prossimi} fatto={fatto} />
            <Gruppo titolo="Senza data" righe={gruppi.senzaData} fatto={fatto} />
          </>
        )}
      </Stato>

      <h2>Ultime note</h2>
      <Stato carica={carica} errore={errore} vuoto={dati && dati.note.length === 0 ? 'Ancora nessuna nota.' : null}>
        {dati && <div className="elenco">{dati.note.map((n) => <NotaRiga key={n.id} nota={n} />)}</div>}
      </Stato>
    </div>
  )
}

function Gruppo({ titolo, righe, fatto, ritardo }) {
  if (!righe.length) return null
  return (
    <>
      <h3 className={ritardo ? 'rosso' : ''}>{titolo}</h3>
      <div className="elenco">
        {righe.map((p) => {
          const a = areaDa(p.area)
          return (
            <div key={p.id} className="riga riga-promemoria">
              <button type="button" className="spunta" onClick={() => fatto(p.id)} aria-label={`Segna fatto: ${p.testo}`} />
              <a className="riga-corpo" href={p.nota_id ? `#/nota/${p.nota_id}` : undefined}>
                <span className="riga-testo">{p.urgente && <strong className="rosso">! </strong>}{p.testo}</span>
                <span className="riga-meta">
                  {a && <span className="etichetta" style={{ color: a.colore }}>{a.nome}</span>}
                  {p.scade_il && ` ${quando(p.scade_il, true)}`}
                </span>
              </a>
            </div>
          )
        })}
      </div>
    </>
  )
}

// Avviso se l'ultimo backup su Drive non è riuscito o è troppo vecchio (si fa ogni domenica).
function AvvisoBackup() {
  const [ultimo, setUltimo] = useState(null)

  useEffect(() => {
    sb.from('backup_registro').select('eseguito_il,ok').order('id', { ascending: false }).limit(1)
      .then(({ data }) => setUltimo(data?.[0] || null))
  }, [])

  if (!ultimo) return null
  const vecchio = giorniDaOggi(ultimo.eseguito_il) < -9
  if (ultimo.ok && !vecchio) return null
  return (
    <div className="scheda scheda-allarme">
      <p>
        {ultimo.ok
          ? `Il backup su Drive non parte da più di una settimana (ultimo: ${quando(ultimo.eseguito_il)}).`
          : `Il backup su Drive non è riuscito (${quando(ultimo.eseguito_il)}).`}
        {' '}Dillo a Claude.
      </p>
    </div>
  )
}

// Invito ad attivare l'accesso con impronta/volto, finché non è attivo.
function AttivaImpronta() {
  const { avvisa } = useApp()
  const [mostra, setMostra] = useState(false)
  const [lavoro, setLavoro] = useState(false)

  useEffect(() => {
    if (!window.PublicKeyCredential || leggi('impronta-rimandata') === '1') return
    sb.auth.passkey.list().then(({ data, error }) => {
      if (error) return
      if (data?.length) scrivi('impronta-attiva', '1')
      else setMostra(true)
    })
  }, [])

  async function attiva() {
    setLavoro(true)
    const { error } = await sb.auth.registerPasskey()
    setLavoro(false)
    if (error) return avvisa('Impronta non attivata: ' + (error.message || 'riprova'))
    scrivi('impronta-attiva', '1')
    setMostra(false)
    avvisa('Fatto. Dalla prossima volta entri con impronta o volto.')
  }

  if (!mostra) return null
  return (
    <div className="scheda scheda-impronta">
      <p>Vuoi entrare con impronta o volto, senza codici?</p>
      <div className="azioni">
        <button type="button" className="tasto-pieno" onClick={attiva} disabled={lavoro}>Attiva</button>
        <button type="button" className="tasto-link" onClick={() => { scrivi('impronta-rimandata', '1'); setMostra(false) }}>
          Più tardi
        </button>
      </div>
    </div>
  )
}
