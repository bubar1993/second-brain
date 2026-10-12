import { useEffect, useState } from 'react'
import { sb, areaDa, leggi, scrivi } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro, useModifiche } from './componenti'
import { capisciLista, pulisci, maiuscola, durata } from './capisci'

// Liste e garanzie (Privato, 13.10.2026, scelte di Giovanni): solo Spesa e Ristoranti e posti; garanzie dalla foto
// dello scontrino, senza avvisi di scadenza. Si riempiono dettando dal + (capisciLista, capisciGaranzia) oppure qui.

const data = (iso) => new Date(iso.length === 10 ? `${iso}T12:00` : iso).toLocaleDateString('it-CH', { day: 'numeric', month: 'numeric', year: 'numeric' })

const Spunta = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)

// ---------- Liste ----------
export function Liste() {
  const [scheda, setScheda] = useState(() => leggi('lista-scelta') || 'spesa')
  const cambia = (s) => { setScheda(s); scrivi('lista-scelta', s) }
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [aperte, comprate] = await Promise.all([
      sb.from('liste_voci').select('*').is('eliminata_il', null).is('fatta_il', null).order('creata_il'),
      sb.from('liste_voci').select('id,testo,fatta_il').eq('lista', 'spesa').is('eliminata_il', null).not('fatta_il', 'is', null)
        .gte('fatta_il', new Date(Date.now() - 45 * 864e5).toISOString()).order('fatta_il', { ascending: false }).limit(80),
    ])
    const a = chk(aperte)
    // Comprati di recente, senza doppioni e senza quelli già di nuovo in lista: un tocco e tornano nella spesa.
    const inLista = new Set(a.filter((v) => v.lista === 'spesa').map((v) => v.testo.toLowerCase()))
    const visti = new Set()
    const recenti = chk(comprate).filter((v) => {
      const k = v.testo.toLowerCase()
      if (inLista.has(k) || visti.has(k)) return false
      visti.add(k)
      return true
    }).slice(0, 16)
    return { spesa: a.filter((v) => v.lista === 'spesa'), ristoranti: a.filter((v) => v.lista === 'ristoranti'), recenti }
  }, [])

  return (
    <div className="schermata liste">
      <Indietro titolo="Liste" />
      <div className="chips schede-liste" role="tablist">
        <button type="button" role="tab" aria-selected={scheda === 'spesa'} className={'chip' + (scheda === 'spesa' ? ' attivo' : '')} onClick={() => cambia('spesa')}>
          Spesa{dati?.spesa.length ? ` · ${dati.spesa.length}` : ''}
        </button>
        <button type="button" role="tab" aria-selected={scheda === 'ristoranti'} className={'chip' + (scheda === 'ristoranti' ? ' attivo' : '')} onClick={() => cambia('ristoranti')}>
          Ristoranti e posti{dati?.ristoranti.length ? ` · ${dati.ristoranti.length}` : ''}
        </button>
      </div>
      <Stato carica={carica} errore={errore}>
        {dati && (scheda === 'spesa'
          ? <Spesa voci={dati.spesa} recenti={dati.recenti} ricarica={ricarica} />
          : <Ristoranti voci={dati.ristoranti} ricarica={ricarica} />)}
      </Stato>
    </div>
  )
}

function Aggiungi({ lista, segnaposto, ricarica }) {
  const { avvisa } = useApp()
  const [testo, setTesto] = useState('')
  useModifiche(!!testo.trim())
  async function aggiungi(e) {
    e.preventDefault()
    const t = testo.trim()
    if (!t) return
    const voci = lista === 'spesa'
      ? t.split(/,|;|\n/).map(pulisci).filter(Boolean).map((v) => ({ lista, testo: v }))
      : (() => { const c = capisciLista(`nei ristoranti ${t}`); return c ? c.voci.map((v) => ({ lista, ...v })) : [{ lista, testo: maiuscola(t) }] })()
    try {
      chk(await sb.from('liste_voci').insert(voci))
      setTesto('')
      ricarica()
    } catch (err) {
      avvisa(messaggioErrore(err))
    }
  }
  return (
    <form className="aggiungi-lista" onSubmit={aggiungi}>
      <input value={testo} onChange={(e) => setTesto(e.target.value)} placeholder={segnaposto} enterKeyHint="done" aria-label={segnaposto} />
      <button type="submit" className="tasto-piccolo" disabled={!testo.trim()}>Aggiungi</button>
    </form>
  )
}

function Spesa({ voci, recenti, ricarica }) {
  const { avvisa } = useApp()
  const [via, setVia] = useState(() => new Set())
  const col = areaDa('P').colore

  async function comprato(v) {
    setVia((s) => new Set(s).add(v.id))
    try {
      chk(await sb.from('liste_voci').update({ fatta_il: new Date().toISOString() }).eq('id', v.id))
      avvisa(`${v.testo}: preso`, {
        etichetta: 'Annulla',
        fai: async () => {
          try {
            chk(await sb.from('liste_voci').update({ fatta_il: null }).eq('id', v.id))
            setVia((s) => { const x = new Set(s); x.delete(v.id); return x })
            ricarica()
          } catch (e) { avvisa(messaggioErrore(e)) }
        },
      })
      setTimeout(ricarica, 700)
    } catch (e) {
      setVia((s) => { const x = new Set(s); x.delete(v.id); return x })
      avvisa(messaggioErrore(e))
    }
  }

  async function rimetti(r) {
    try {
      chk(await sb.from('liste_voci').insert({ lista: 'spesa', testo: r.testo }))
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  return (
    <>
      <Aggiungi lista="spesa" segnaposto="Aggiungi alla spesa (anche: latte, pane, uova)" ricarica={ricarica} />
      {voci.length === 0
        ? <p className="msg">Spesa vuota. Dal + puoi dire «metti il latte nella spesa».</p>
        : (
          <div className="elenco">
            {voci.map((v) => (
              <div key={v.id} className={'voce-promemoria' + (via.has(v.id) ? ' via' : '')}>
                <div>
                  <div style={{ '--col': col }} className={'riga riga-promemoria' + (via.has(v.id) ? ' fatto' : '')}>
                    <button type="button" className="spunta" onClick={() => comprato(v)} aria-label={`Preso: ${v.testo}`}><Spunta /></button>
                    <span className="riga-corpo"><span className="riga-testo">{v.testo}</span></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      {recenti.length > 0 && (
        <>
          <h3>Presi di recente</h3>
          <p className="nota-piccola">Tocca per rimetterlo nella spesa.</p>
          <div className="chips">
            {recenti.map((r) => <button key={r.id} type="button" className="chip" onClick={() => rimetti(r)}>+ {r.testo}</button>)}
          </div>
        </>
      )}
    </>
  )
}

function Stelle({ voto, scegli, nome }) {
  return (
    <span className="stelle" role="group" aria-label={`Voto per ${nome}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={n <= (voto || 0) ? 'piena' : ''} onClick={() => scegli(n === voto ? null : n)}
          aria-label={`${n} stell${n === 1 ? 'a' : 'e'}`} aria-pressed={n <= (voto || 0)}>★</button>
      ))}
    </span>
  )
}

function Ristoranti({ voci, ricarica }) {
  const { avvisa } = useApp()
  const [aperto, setAperto] = useState(null)
  const daProvare = voci.filter((v) => !v.provato)
  const provati = voci.filter((v) => v.provato).sort((a, b) => (b.voto || 0) - (a.voto || 0))

  async function cambia(v, campi, messaggio) {
    try {
      chk(await sb.from('liste_voci').update({ ...campi, modificata_il: new Date().toISOString() }).eq('id', v.id))
      if (messaggio) avvisa(messaggio)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  const riga = (v) => (
    <div key={v.id}>
      <div className="riga riga-ristorante">
        <button type="button" className="riga-corpo riga-tocca" onClick={() => setAperto(aperto === v.id ? null : v.id)} aria-expanded={aperto === v.id}>
          <span className="riga-testo">{v.testo}</span>
          {v.dettagli && <span className="riga-meta">{v.dettagli}</span>}
        </button>
        <Stelle voto={v.voto} nome={v.testo} scegli={(n) => cambia(v, { voto: n, provato: n ? true : v.provato })} />
      </div>
      {aperto === v.id && <ModificaRistorante v={v} cambia={cambia} chiudi={() => setAperto(null)} />}
    </div>
  )

  return (
    <>
      <Aggiungi lista="ristoranti" segnaposto="Aggiungi un ristorante o un posto" ricarica={ricarica} />
      {voci.length === 0 && <p className="msg">Nessun posto ancora. Dal + puoi dire «grotto del Mulino consigliato da Paolo».</p>}
      {daProvare.length > 0 && (<><h3>Da provare</h3><div className="elenco">{daProvare.map(riga)}</div></>)}
      {provati.length > 0 && (<><h3>Provati</h3><div className="elenco">{provati.map(riga)}</div></>)}
      {voci.length > 0 && <p className="nota-piccola">Tocca le stelle per il voto (così passa tra i provati). Tocca il nome per correggere.</p>}
    </>
  )
}

function ModificaRistorante({ v, cambia, chiudi }) {
  const [testo, setTesto] = useState(v.testo)
  const [dettagli, setDettagli] = useState(v.dettagli || '')
  const cambiato = testo.trim() !== v.testo || dettagli.trim() !== (v.dettagli || '')
  useModifiche(cambiato)
  return (
    <div className="modifica-promemoria">
      <input value={testo} onChange={(e) => setTesto(e.target.value)} aria-label="Nome" />
      <textarea value={dettagli} onChange={(e) => setDettagli(e.target.value)} rows={2} placeholder="Dove, chi l'ha consigliato, cosa prendere" aria-label="Dettagli" />
      <div className="azioni">
        {cambiato && <button type="button" className="tasto-piccolo tasto-salva" onClick={() => { cambia(v, { testo: testo.trim() || v.testo, dettagli: dettagli.trim() || null }, 'Salvato'); chiudi() }}>Salva</button>}
        <button type="button" className="tasto-link" onClick={() => cambia(v, { provato: !v.provato }, v.provato ? 'Rimesso tra quelli da provare' : 'Segnato come provato')}>
          {v.provato ? 'Non ancora provato' : 'Provato'}
        </button>
        <button type="button" className="tasto-link" onClick={chiudi}>Chiudi</button>
        <button type="button" className="tasto-link pericolo" onClick={() => cambia(v, { eliminata_il: new Date().toISOString() }, 'Tolto dalla lista')}>Togli</button>
      </div>
    </div>
  )
}

// ---------- Garanzie ----------
export function Garanzie() {
  const { avvisa } = useApp()
  const [aperta, setAperta] = useState(null)
  const [scadute, setScadute] = useState(false)
  const [foto, setFoto] = useState({})
  const { dati, errore, carica, ricarica } = useCarica(async () => chk(
    await sb.from('garanzie').select('*,note(id,allegati(id,percorso))').is('eliminata_il', null).order('scade_il', { ascending: true }),
  ), [])

  // Miniature degli scontrini (la prima foto di ogni nota).
  useEffect(() => {
    const percorsi = (dati || []).map((g) => g.note?.allegati?.[0]?.percorso).filter(Boolean)
    if (!percorsi.length) return
    sb.storage.from('allegati').createSignedUrls(percorsi, 3600).then(({ data: d }) => {
      setFoto(Object.fromEntries((d || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])))
    })
  }, [dati])

  async function cambia(g, campi, messaggio) {
    try {
      chk(await sb.from('garanzie').update({ ...campi, modificata_il: new Date().toISOString() }).eq('id', g.id))
      avvisa(messaggio)
      setAperta(null)
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  const oggi = new Date().toISOString().slice(0, 10)
  const valide = (dati || []).filter((g) => g.scade_il >= oggi)
  const finite = (dati || []).filter((g) => g.scade_il < oggi).reverse()

  const riga = (g) => {
    const f = foto[g.note?.allegati?.[0]?.percorso]
    return (
      <div key={g.id}>
        <div className="riga riga-garanzia">
          {g.nota_id
            ? <a className="scontrino" href={`#/nota/${g.nota_id}`} aria-label={`Scontrino: ${g.cosa}`}>{f ? <img src={f} alt="" /> : <span>Nota</span>}</a>
            : <span className="scontrino"><span>—</span></span>}
          <button type="button" className="riga-corpo riga-tocca" onClick={() => setAperta(aperta === g.id ? null : g.id)} aria-expanded={aperta === g.id}>
            <span className="riga-testo">{g.cosa}</span>
            <span className="riga-meta">{[g.negozio, `comprata ${data(g.comprata_il)}`, `${durata(g.mesi)}`].filter(Boolean).join(' · ')}</span>
            <span className={'riga-meta' + (g.scade_il < oggi ? ' rosso' : '')}>{g.scade_il < oggi ? 'Finita il' : 'In garanzia fino al'} {data(g.scade_il)}</span>
          </button>
        </div>
        {aperta === g.id && <ModificaGaranzia g={g} cambia={cambia} chiudi={() => setAperta(null)} />}
      </div>
    )
  }

  return (
    <div className="schermata">
      <Indietro titolo="Garanzie" />
      <p className="nota-piccola">Dal + fai la foto dello scontrino e scrivi o detta per esempio «garanzia lavatrice Fust 2 anni». Tocca lo scontrino per vederlo grande.</p>
      <Stato carica={carica} errore={errore} vuoto={dati?.length === 0 ? 'Nessuna garanzia ancora.' : null}>
        {dati && (
          <>
            {valide.length > 0 && <div className="elenco">{valide.map(riga)}</div>}
            {finite.length > 0 && (
              <>
                <button type="button" className="tasto-link" onClick={() => setScadute(!scadute)} aria-expanded={scadute}>
                  {scadute ? 'Nascondi quelle finite' : `Garanzie finite: ${finite.length}`}
                </button>
                {scadute && <div className="elenco">{finite.map(riga)}</div>}
              </>
            )}
          </>
        )}
      </Stato>
    </div>
  )
}

function ModificaGaranzia({ g, cambia, chiudi }) {
  const [cosa, setCosa] = useState(g.cosa)
  const [negozio, setNegozio] = useState(g.negozio || '')
  const [comprata, setComprata] = useState(g.comprata_il)
  const [mesi, setMesi] = useState(String(g.mesi))
  const cambiato = cosa.trim() !== g.cosa || negozio.trim() !== (g.negozio || '') || comprata !== g.comprata_il || Number(mesi) !== g.mesi
  useModifiche(cambiato)
  return (
    <div className="modifica-promemoria">
      <input value={cosa} onChange={(e) => setCosa(e.target.value)} aria-label="Cosa" />
      <input value={negozio} onChange={(e) => setNegozio(e.target.value)} placeholder="Negozio" aria-label="Negozio" />
      <div className="due">
        <label className="campo">Comprata il<input type="date" value={comprata} onChange={(e) => setComprata(e.target.value)} /></label>
        <label className="campo">Mesi di garanzia<input type="number" min="1" max="240" inputMode="numeric" value={mesi} onChange={(e) => setMesi(e.target.value)} /></label>
      </div>
      <div className="azioni">
        {cambiato && (
          <button type="button" className="tasto-piccolo tasto-salva"
            onClick={() => cambia(g, { cosa: cosa.trim() || g.cosa, negozio: negozio.trim() || null, comprata_il: comprata || g.comprata_il, mesi: Math.min(240, Math.max(1, Number(mesi) || g.mesi)) }, 'Salvato')}>
            Salva
          </button>
        )}
        <button type="button" className="tasto-link" onClick={chiudi}>Chiudi</button>
        <button type="button" className="tasto-link pericolo" onClick={() => cambia(g, { eliminata_il: new Date().toISOString() }, 'Garanzia tolta')}>Togli</button>
      </div>
    </div>
  )
}
