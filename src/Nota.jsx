import { useEffect, useRef, useState } from 'react'
import { sb, areaDa, quando } from './supabase'
import {
  useApp, useCarica, chk, messaggioErrore, Stato, Indietro, SceltaArea, SceltaPersone, SceltaDitta, Icona,
  caricaFoto, aggiungiAreaPersone, useModifiche,
} from './componenti'
import { nomeSezione, useRisolvi } from './Aziende'
import { CampoNota, TestoConCaselle, haCaselle, spuntaRiga } from './CampoNota'

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
      .select('*,aziende(id,nome),note_persone(persone(id,nome,cognome)),allegati(id,percorso),promemoria(id,testo,scade_il,fatto_il,eliminata_il),eventi(id,promemoria_id,stato)')
      .eq('id', id).single(),
  ), [id])
  const risolvi = useRisolvi(ricarica)

  // Il testo si salva da solo (09.11.2026): un secondo e mezzo dopo l'ultima lettera, e uscendo dalla nota.
  // `salvato` = l'ultimo testo nel database; `originale` = com'era aprendo la nota ("Torna com'era").
  const [salvato, setSalvato] = useState(null)
  const [originale, setOriginale] = useState(null)
  const [statoTesto, setStatoTesto] = useState('')
  useEffect(() => {
    if (dati && testo === null) { setTesto(dati.testo); setSalvato(dati.testo); setOriginale(dati.testo) }
  }, [dati, testo])
  const daSalvare = testo !== null && salvato !== null && !!testo.trim() && testo.trim() !== salvato
  useModifiche(daSalvare)
  const salvaRif = useRef(null)
  salvaRif.current = daSalvare ? testo.trim() : null
  const scriviTesto = async (t) => {
    const { error } = await sb.from('note').update({ testo: t }).eq('id', id)
    if (error) { setStatoTesto(`Non salvata: ${messaggioErrore(error)}`); return }
    setSalvato(t)
    setStatoTesto('Salvata')
  }
  useEffect(() => {
    if (!daSalvare) return
    setStatoTesto('Salvo…')
    const t = setTimeout(() => scriviTesto(testo.trim()), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testo, daSalvare])
  // Uscendo con una modifica ancora da salvare: la salvo subito.
  useEffect(() => () => {
    if (salvaRif.current) sb.from('note').update({ testo: salvaRif.current }).eq('id', id).then(() => {})
  }, [id])

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

  // Cliente della nota (09.11.2026): si sposta in un'altra scheda o si toglie. Col cliente l'area diventa la sua;
  // il cantiere era dell'altro cliente, quindi si toglie.
  const cambiaDitta = (d) => esegui(async () => {
    chk(await sb.from('note').update({ azienda_id: d?.id || null, cantiere_id: null, ...(d ? { area: d.area } : {}) }).eq('id', id))
    if (d) await aggiungiAreaPersone(d.area, persone.map((p) => p.id))
  }, d ? `Messa nella scheda ${d.nome}` : 'Tolta dalla scheda')

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

  // "Metti in calendario" (21.10.2026): appuntamento di mezz'ora all'ora del promemoria, 'da_creare';
  // l'agente calendario lo crea in Google al giro dopo (lo sveglia il portinaio, di giorno entro ~20 minuti).
  const inCalendario = (p) => dati.eventi.some((e) => e.promemoria_id === p.id && !['scartato', 'cancellato'].includes(e.stato))
  const mettiInCalendario = (p) => esegui(async () => {
    const inizio = new Date(p.scade_il)
    chk(await sb.from('eventi').insert({
      titolo: p.testo || testo.trim() || 'Promemoria', area: dati.area, stato: 'da_creare', proposto_da: 'giovanni',
      inizio: inizio.toISOString(), fine: new Date(inizio.getTime() + 30 * 60000).toISOString(),
      nota_id: id, promemoria_id: p.id, motivo: 'dal promemoria della nota',
    }))
  }, 'Va in calendario entro 10 minuti (di notte alle 6)')

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

  // Dal 13.10.2026 anche le note copiate dal gestionale Ceramex si correggono qui (la copia delle note è spenta).
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
      {dati.sezione === 'problemi' && (
        <p className="nota-piede">
          <span>{dati.risolto_il ? 'Problema risolto' : 'Problema aperto'}</span>
          <button type="button" className="tasto-risolto" onClick={() => risolvi(dati)}>{dati.risolto_il ? 'Riapri' : '✓ Risolto'}</button>
        </p>
      )}

      {/* Le caselle della nota si spuntano qui sopra, senza cercare la riga nel testo (10.11.2026). */}
      {haCaselle(testo) && (
        <div className="scheda caselle-nota">
          <TestoConCaselle testo={testo} soloCaselle onSpunta={(i) => setTesto(spuntaRiga(testo, i))} />
        </div>
      )}
      {/* Alta quanto il testo: una nota lunga si legge tutta. Elenchi, caselle e @ come nel "+". */}
      <CampoNota value={testo} onChange={setTesto} rows={6} autoAlto onCollega={(v) => {
        if (v.tipo === 'persona') { if (!persone.some((p) => p.id === v.x.id)) cambiaPersone([...persone, v.x]) }
        else if (!dati.aziende && dati.area !== 'P') cambiaDitta(v.x)
      }} />
      {(statoTesto || testo.trim() !== originale) && (
        <p className="nota-piccola" role="status">
          {!testo.trim() ? 'Vuota: non la salvo.' : statoTesto}
          {testo.trim() !== originale && (
            <> <button type="button" className="tasto-link" onClick={() => setTesto(originale)}>Torna com'era</button></>
          )}
        </p>
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

      <div className="campo">
        <span>Area</span>
        <SceltaArea valore={dati.area} onChange={cambiaArea} />
      </div>

      {dati.area !== 'P' && (
        <div className="campo">
          <span>Cliente</span>
          <SceltaDitta valore={dati.aziende} area={dati.area} onChange={cambiaDitta} />
        </div>
      )}

      <div className="campo">
        <span>Persone</span>
        <SceltaPersone valore={persone} onChange={cambiaPersone} />
      </div>

      <div className="campo">
        <span>Promemoria</span>
        {promemoria.map((p) => (
          <div key={p.id} className="riga-campo">
            <label className="promemoria-nota">
              <input type="checkbox" checked={!!p.fatto_il} onChange={() => fatto(p)} />
              <span className={p.fatto_il ? 'barrato' : ''}>{quando(p.scade_il, true) || 'senza data'}</span>
            </label>
            {p.scade_il && !p.fatto_il && (inCalendario(p)
              ? <span className="nota-piccola">In calendario</span>
              : <button type="button" className="tasto-piccolo" onClick={() => mettiInCalendario(p)} disabled={lavoro}>Metti in calendario</button>)}
          </div>
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

      <button type="button" className="tasto-link pericolo" onClick={elimina}>Metti nel cestino</button>
    </div>
  )
}
