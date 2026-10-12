import { useEffect, useRef, useState } from 'react'
import { sb, areaDa, quando } from './supabase'
import {
  useApp, useCarica, chk, messaggioErrore, Stato, Indietro, SceltaArea, SceltaPersone, Icona,
  caricaFoto, aggiungiAreaPersone, useModifiche,
} from './componenti'
import { nomeSezione } from './Aziende'

const FONTI = { scritta: 'Scritta', voce: 'Dettata', foto: 'Foto', condivisa: 'Condivisa', mail: 'Da mail' }

export default function Nota({ id }) {
  const { avvisa, utente } = useApp()
  const [testo, setTesto] = useState(null)
  const [foto, setFoto] = useState([])
  const [nuovoPromemoria, setNuovoPromemoria] = useState('')
  const [lavoro, setLavoro] = useState(false)
  const fotoRif = useRef(null)

  const { dati, errore, carica, ricarica } = useCarica(async () => chk(
    await sb.from('note')
      .select('*,aziende(id,nome),note_persone(persone(id,nome,cognome)),allegati(id,percorso),promemoria(id,testo,scade_il,fatto_il,eliminata_il)')
      .eq('id', id).single(),
  ), [id])

  useEffect(() => {
    if (dati && testo === null) setTesto(dati.testo)
  }, [dati, testo])
  useModifiche(!!dati && testo !== null && testo.trim() !== dati.testo)

  // Link temporanei (1 ora) per vedere le foto private.
  useEffect(() => {
    const percorsi = (dati?.allegati || []).map((a) => a.percorso)
    if (!percorsi.length) { setFoto([]); return }
    sb.storage.from('allegati').createSignedUrls(percorsi, 3600)
      .then(({ data }) => setFoto((data || []).filter((x) => x.signedUrl)))
  }, [dati])

  if (!dati || testo === null) {
    return <div className="schermata"><Indietro titolo="Nota" /><Stato carica={carica} errore={errore} /></div>
  }

  const persone = dati.note_persone.map((np) => np.persone).filter(Boolean)
  const promemoria = dati.promemoria.filter((p) => !p.eliminata_il)
  const a = areaDa(dati.area)

  async function esegui(fn, messaggio) {
    setLavoro(true)
    try {
      await fn()
      if (messaggio) avvisa(messaggio)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  const salvaTesto = () => esegui(async () => {
    chk(await sb.from('note').update({ testo: testo.trim() }).eq('id', id))
  }, 'Salvata')

  const cambiaArea = (area) => esegui(async () => {
    chk(await sb.from('note').update({ area }).eq('id', id))
    await aggiungiAreaPersone(area, persone.map((p) => p.id))
  }, area ? `Spostata in ${areaDa(area).nome}` : 'Spostata nell\'Inbox')

  const cambiaPersone = (nuove) => esegui(async () => {
    const aggiunte = nuove.filter((n) => !persone.some((p) => p.id === n.id))
    const tolte = persone.filter((p) => !nuove.some((n) => n.id === p.id))
    if (aggiunte.length) {
      chk(await sb.from('note_persone').insert(aggiunte.map((p) => ({ nota_id: id, persona_id: p.id }))))
      await aggiungiAreaPersone(dati.area, aggiunte.map((p) => p.id))
    }
    for (const p of tolte) chk(await sb.from('note_persone').delete().eq('nota_id', id).eq('persona_id', p.id))
  })

  const aggiungiFoto = (e) => {
    const files = [...e.target.files]
    e.target.value = ''
    esegui(async () => { for (const f of files) await caricaFoto(utente.id, id, f) }, 'Foto aggiunta')
  }

  const aggiungiPromemoria = () => {
    if (!nuovoPromemoria) return avvisa('Scegli quando')
    esegui(async () => {
      chk(await sb.from('promemoria').insert({
        testo: testo.trim() || 'Foto', area: dati.area, nota_id: id,
        scade_il: new Date(nuovoPromemoria).toISOString(),
      }))
      setNuovoPromemoria('')
    }, 'Promemoria aggiunto')
  }

  const fatto = (p) => esegui(async () => {
    chk(await sb.from('promemoria').update({ fatto_il: p.fatto_il ? null : new Date().toISOString() }).eq('id', p.id))
  })

  async function elimina() {
    if (!confirm('Mettere la nota nel cestino?')) return
    try {
      chk(await sb.from('note').update({ eliminata_il: new Date().toISOString() }).eq('id', id))
      avvisa('Nel cestino')
      history.back()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  // Le note copiate dal gestionale Ceramex si correggono là: qui il testo verrebbe riscritto dalla copia.
  const daCeramex = dati.da_ceramex && dati.area === 'C'

  return (
    <div className="schermata">
      <Indietro titolo="Nota" />
      <p className="nota-piccola">
        {a && <span className="etichetta" style={{ color: a.colore }}>{a.nome} · </span>}
        {!a && 'Inbox · '}{FONTI[dati.fonte]} {quando(dati.creata_il, true)}
      </p>
      {dati.aziende && (
        <p className="nota-piccola">
          <a href={`#/azienda/${dati.aziende.id}`}>{dati.aziende.nome}</a>
          {[dati.mandante, nomeSezione[dati.sezione], dati.contatto].filter(Boolean).map((x) => ` · ${x}`)}
          {dati.risolto_il && ` · risolto ${quando(dati.risolto_il)}`}
        </p>
      )}

      <textarea value={testo} onChange={(e) => setTesto(e.target.value)} rows={6} readOnly={daCeramex} />
      {daCeramex && (
        <p className="nota-piccola">Questa nota arriva dal gestionale Ceramex: testo e area si correggono lì. Qui puoi collegare persone, promemoria e foto.</p>
      )}
      {!daCeramex && testo.trim() !== dati.testo && (
        <button type="button" className="tasto-grande" onClick={salvaTesto} disabled={lavoro}>Salva</button>
      )}

      {foto.length > 0 && (
        <div className="miniature grandi">
          {foto.map((f) => (
            <a key={f.path} href={f.signedUrl} target="_blank" rel="noreferrer" className="miniatura">
              <img src={f.signedUrl} alt="Foto della nota" />
            </a>
          ))}
        </div>
      )}

      {!daCeramex && (
        <div className="campo">
          <span>Area</span>
          <SceltaArea valore={dati.area} onChange={cambiaArea} />
        </div>
      )}

      <div className="campo">
        <span>Persone</span>
        <SceltaPersone valore={persone} onChange={cambiaPersone} />
      </div>

      <div className="campo">
        <span>Promemoria</span>
        {promemoria.map((p) => (
          <label key={p.id} className="promemoria-nota">
            <input type="checkbox" checked={!!p.fatto_il} onChange={() => fatto(p)} />
            <span className={p.fatto_il ? 'barrato' : ''}>{quando(p.scade_il, true) || 'senza data'}</span>
          </label>
        ))}
        <div className="riga-campo">
          <input type="datetime-local" value={nuovoPromemoria} onChange={(e) => setNuovoPromemoria(e.target.value)} />
          <button type="button" className="tasto-piccolo" onClick={aggiungiPromemoria} disabled={lavoro}>Aggiungi</button>
        </div>
      </div>

      <div className="azioni">
        <button type="button" className="tasto-piccolo" onClick={() => fotoRif.current?.click()} disabled={lavoro}>
          <Icona nome="foto" size={18} /> Aggiungi foto
        </button>
        <input ref={fotoRif} type="file" accept="image/*" multiple hidden onChange={aggiungiFoto} />
      </div>

      {!daCeramex && <button type="button" className="tasto-link pericolo" onClick={elimina}>Metti nel cestino</button>}
    </div>
  )
}
