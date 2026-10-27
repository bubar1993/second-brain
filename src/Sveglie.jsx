import { useState } from 'react'
import { useApp, useCarica, chiama, messaggioErrore, Stato, Indietro, useModifiche, useDueTocchi } from './componenti'

// Sveglie Sonos (Privato, 21.10.2026, scelte di Giovanni): le 4 sveglie del mattino (ora, acceso/spento) e il tasto
// rapido "Alessia non c'è questa settimana" (giovedì e venerdì come lunedì–mercoledì; la settimana dopo torna normale).
// Tutto passa dalla funzione `sonos`: le tabelle delle sveglie l'app non le vede.
// 24.10.2026: "+ Nuova sveglia" (giorni, ora, cassa, una delle frasi standard, musica) e "Togli sveglia" (due tocchi).
// 27.10.2026: volume voce e volume musica si scelgono qui (toccando l'ora e nella nuova sveglia).
// 27.10.2026: blocco "Messaggi": una frase scritta da Giovanni, un giorno, un'ora, una o più stanze, detta una volta.

const NOMI_GIORNI = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const giorni = (g) => {
  const s = [...g].sort()
  const filati = s.every((x, i) => i === 0 || x === s[i - 1] + 1)
  return filati && s.length > 1 ? `${NOMI_GIORNI[s[0]]}–${NOMI_GIORNI[s[s.length - 1]]}` : s.map((x) => NOMI_GIORNI[x]).join(', ')
}
const quandoData = (d) => {
  const oggi = new Date().toLocaleDateString('sv-SE')
  const domani = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE')
  if (d === oggi) return 'oggi'
  if (d === domani) return 'domani'
  if (d === new Date(Date.now() - 864e5).toLocaleDateString('sv-SE')) return 'ieri'
  return new Date(`${d}T12:00`).toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'numeric' })
}
const musica = (p) => (p || '').replace(/^this is\s+/i, '')

export function Sveglie() {
  const { avvisa } = useApp()
  const [aperta, setAperta] = useState(null)
  const [nuova, setNuova] = useState(false)
  const [nuovoMsg, setNuovoMsg] = useState(false)
  const [lavora, setLavora] = useState(false)
  const { dati, errore, carica, ricarica } = useCarica(() => chiama('sonos', { azione: 'sveglie_elenco', completo: true }), [])

  async function fai(corpo, messaggio) {
    setLavora(true)
    try {
      const r = await chiama('sonos', corpo)
      avvisa(typeof messaggio === 'function' ? messaggio(r) : messaggio)
      setAperta(null)
      setNuova(false)
      setNuovoMsg(false)
      await ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavora(false)
    }
  }

  const casse = dati ? [...new Set(dati.sveglie.map((s) => s.cassa))] : []
  const senza = dati?.senza_alessia

  return (
    <div className="schermata">
      <Indietro titolo="Sveglie" />
      <Stato carica={carica && !dati} errore={errore}>
        {dati && (
          <>
            {dati.prossima && (
              <p className="nota-piccola">Prossima sveglia: <b>{quandoData(dati.prossima.data)} alle {dati.prossima.ora}</b> in {dati.prossima.cassa}</p>
            )}

            {dati.senza_alessia_possibile && (
              <div className="scheda scheda-modulo scheda-sveglie">
                <button type="button" className={'tasto-grande' + (senza ? ' tasto-attivo' : '')} disabled={lavora}
                  aria-pressed={senza}
                  onClick={() => fai({ azione: 'senza_alessia', attiva: !senza },
                    senza ? 'Giovedì e venerdì di nuovo normali' : 'Giovedì e venerdì come lunedì–mercoledì')}>
                  {senza ? '✓ Questa settimana Alessia non c\'è' : 'Alessia non c\'è questa settimana'}
                </button>
                <p className="riga-meta">
                  {senza
                    ? 'Giovedì e venerdì suonano come lunedì–mercoledì. Tocca di nuovo per tornare normale.'
                    : 'Con un tocco giovedì e venerdì di questa settimana diventano come lunedì–mercoledì. La settimana dopo torna tutto normale da solo.'}
                </p>
              </div>
            )}

            {casse.map((cassa) => (
              <div key={cassa}>
                <h2>{cassa}</h2>
                <div className="elenco">
                  {dati.sveglie.filter((s) => s.cassa === cassa).map((s) => (
                    <div key={s.id}>
                      <div className={'riga riga-sveglia' + (s.attiva ? '' : ' spenta')}>
                        <button type="button" className="sveglia-ora" onClick={() => setAperta(aperta === s.id ? null : s.id)}
                          aria-expanded={aperta === s.id} aria-label={`Cambia ora e volume, adesso ${s.ora.slice(0, 5)}`}>
                          {s.ora.slice(0, 5)}
                        </button>
                        <div className="riga-corpo">
                          <span className="riga-testo">{giorni(s.giorni)} · «{s.saluto}»</span>
                          <span className="riga-meta">{[s.notizie || s.per === 'giovanni' ? 'meteo, battuta e notizie' : 'canzoncina, meteo e indovinello',
                            s.preferito && `poi ${musica(s.preferito)}`].filter(Boolean).join(' · ')}</span>
                          <span className="riga-meta">Volume voce {s.volume_voce}, musica {s.volume_musica} · la musica si ferma dopo {s.musica_minuti} min</span>
                          {s.errore && <span className="riga-meta rosso">Ultima volta: {s.errore}</span>}
                        </div>
                        <label className="sveglia-accesa">
                          <input type="checkbox" checked={s.attiva} disabled={lavora}
                            onChange={() => fai({ azione: 'sveglia_cambia', id: s.id, attiva: !s.attiva }, s.attiva ? 'Sveglia spenta' : 'Sveglia accesa')} />
                          <span>{s.attiva ? 'Accesa' : 'Spenta'}</span>
                        </label>
                      </div>
                      {aperta === s.id && (
                        <CambiaSveglia s={s} lavora={lavora} chiudi={() => setAperta(null)}
                          salva={(campi) => fai({ azione: 'sveglia_cambia', id: s.id, ...campi }, 'Sveglia cambiata')}
                          togli={() => fai({ azione: 'sveglia_togli', id: s.id }, 'Sveglia tolta')} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {nuova
              ? <NuovaSveglia dati={dati} lavora={lavora} chiudi={() => setNuova(false)}
                  salva={(corpo) => fai({ azione: 'sveglia_nuova', ...corpo }, `Nuova sveglia alle ${corpo.ora}`)} />
              : <button type="button" className="tasto-secondario tasto-nuova-sveglia" onClick={() => setNuova(true)}>+ Nuova sveglia</button>}

            <h2>Messaggi</h2>
            <p className="riga-meta">Una frase tua, detta da Laomedeia una volta sola, a un'ora precisa, in una o più stanze.</p>
            {dati.messaggi?.length > 0 && (
              <div className="elenco">
                {dati.messaggi.map((m) => (
                  <RigaMessaggio key={m.id} m={m} lavora={lavora}
                    togli={() => fai({ azione: 'messaggio_togli', id: m.id }, 'Messaggio tolto')} />
                ))}
              </div>
            )}
            {nuovoMsg
              ? <NuovoMessaggio casse={dati.casse?.length ? dati.casse : ['Bambini', 'Camera Mia', 'Corridoio', 'Salotto']} lavora={lavora}
                  chiudi={() => setNuovoMsg(false)}
                  salva={(corpo) => fai({ azione: 'messaggio_nuovo', ...corpo }, (r) => r?.voce_pronta === false
                    ? 'Messaggio salvato, ma la voce non è ancora pronta: la riprovo all\'ora giusta'
                    : `Messaggio pronto: ${quandoData(corpo.data)} alle ${corpo.ora}`)} />
              : <button type="button" className="tasto-secondario tasto-nuova-sveglia" onClick={() => setNuovoMsg(true)}>+ Nuovo messaggio</button>}

            <p className="nota-piccola">Nei giorni di scuola chiusa le sveglie non suonano. Tocca l'ora per cambiare ora e volume. I minuti di musica si cambiano dicendolo al Capo o a Claude.</p>
          </>
        )}
      </Stato>
    </div>
  )
}

// Volume da 0 a 100 come nell'app Sonos; qui voce 5–60 e musica 1–60 (oltre è troppo forte per una sveglia).
function Volume({ etichetta, valore, min, cambia }) {
  return (
    <label className="campo campo-volume">
      <span>{etichetta} <b>{valore}</b></span>
      <input type="range" min={min} max={60} step={1} value={valore} onChange={(e) => cambia(Number(e.target.value))} />
    </label>
  )
}

// 27.10.2026: oltre all'ora, i due volumi (voce e musica).
function CambiaSveglia({ s, salva, chiudi, togli, lavora }) {
  const [ora, setOra] = useState(s.ora.slice(0, 5))
  const [voce, setVoce] = useState(s.volume_voce)
  const [musicaVol, setMusicaVol] = useState(s.volume_musica)
  const due = useDueTocchi()
  const campi = {
    ...(ora && ora !== s.ora.slice(0, 5) && { ora }),
    ...(voce !== s.volume_voce && { volume_voce: voce }),
    ...(musicaVol !== s.volume_musica && { volume_musica: musicaVol }),
  }
  const cambiato = Object.keys(campi).length > 0
  useModifiche(cambiato)
  return (
    <div className="modifica-promemoria">
      <label className="campo">Ora<input type="time" value={ora} onChange={(e) => setOra(e.target.value)} /></label>
      <Volume etichetta="Volume voce" valore={voce} min={5} cambia={setVoce} />
      {s.preferito && <Volume etichetta="Volume musica" valore={musicaVol} min={1} cambia={setMusicaVol} />}
      <div className="azioni">
        {cambiato && <button type="button" className="tasto-piccolo tasto-salva" disabled={lavora} onClick={() => salva(campi)}>Salva</button>}
        <button type="button" className="tasto-link" onClick={chiudi}>Chiudi</button>
        {/* Togliere non si annulla: due tocchi. */}
        <button type="button" className={'tasto-link pericolo' + (due.armato === 'togli' ? ' pericolo-pieno' : '')} disabled={lavora}
          onClick={() => due.tocca('togli', togli)}>{due.armato === 'togli' ? 'Tocca ancora: togli' : 'Togli sveglia'}</button>
      </div>
    </div>
  )
}

// Messaggio a un'ora precisa (27.10.2026): in attesa, detto, o non detto (il giro lo dice solo entro 15 minuti).
function RigaMessaggio({ m, togli, lavora }) {
  const due = useDueTocchi()
  const ora = m.ora.slice(0, 5)
  const passato = Date.now() - new Date(`${m.data}T${ora}`).getTime() > 15 * 60e3
  const detto = m.detto_il && new Date(m.detto_il).toLocaleTimeString('it-CH', { hour: '2-digit', minute: '2-digit' })
  // dette = stanze dove ha suonato davvero (null mentre lo sta dicendo).
  const dette = m.dette || []
  const stato = !detto ? (passato ? 'Non detto' : 'In attesa')
    : !m.dette ? 'Lo sto dicendo…'
    : !dette.length ? 'Non detto'
    : dette.length < m.casse.length ? `Detto alle ${detto} solo in ${dette.join(', ')}` : `Detto alle ${detto}`
  return (
    <div className={'riga riga-sveglia' + (m.detto_il || passato ? ' spenta' : '')}>
      <span className="sveglia-ora">{ora}</span>
      <div className="riga-corpo">
        <span className="riga-testo">«{m.testo}»</span>
        <span className="riga-meta">{quandoData(m.data)} · {m.casse.join(', ')} · volume {m.volume}</span>
        <span className="riga-meta">{stato}</span>
        {m.errore && <span className="riga-meta rosso">{m.errore}</span>}
      </div>
      {/* Togliere non si annulla: due tocchi. */}
      <button type="button" className={'tasto-link pericolo' + (due.armato === 'togli' ? ' pericolo-pieno' : '')} disabled={lavora}
        onClick={() => due.tocca('togli', togli)}>{due.armato === 'togli' ? 'Tocca ancora' : 'Togli'}</button>
    </div>
  )
}

function NuovoMessaggio({ casse, salva, chiudi, lavora }) {
  const oggi = new Date().toLocaleDateString('sv-SE')
  const domani = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE')
  const [data, setData] = useState(domani)
  const [ora, setOra] = useState('08:00')
  const [scelte, setScelte] = useState([])
  const [testo, setTesto] = useState('')
  const [volume, setVolume] = useState(20)
  useModifiche(testo.trim().length > 0)
  const cambiaCassa = (c) => setScelte(scelte.includes(c) ? scelte.filter((x) => x !== c) : [...scelte, c])
  const passata = data === oggi && ora && ora <= new Date().toTimeString().slice(0, 5)
  const pronta = data && ora && !passata && scelte.length > 0 && testo.trim()
  return (
    <div className="scheda scheda-modulo nuova-sveglia nuovo-messaggio">
      <h3>Nuovo messaggio</h3>
      <p className="riga-meta">Giorno</p>
      <div className="chips">
        <button type="button" className={'chip' + (data === oggi ? ' attivo' : '')} aria-pressed={data === oggi} onClick={() => setData(oggi)}>Oggi</button>
        <button type="button" className={'chip' + (data === domani ? ' attivo' : '')} aria-pressed={data === domani} onClick={() => setData(domani)}>Domani</button>
      </div>
      <label className="campo">Altro giorno<input type="date" value={data} min={oggi} onChange={(e) => setData(e.target.value)} /></label>
      <label className="campo">Ora<input type="time" value={ora} onChange={(e) => setOra(e.target.value)} /></label>
      <p className="riga-meta">Stanze (anche più di una)</p>
      <div className="chips">
        {casse.map((c) => (
          <button key={c} type="button" className={'chip' + (scelte.includes(c) ? ' attivo' : '')} aria-pressed={scelte.includes(c)} onClick={() => cambiaCassa(c)}>{c}</button>
        ))}
      </div>
      <label className="campo">Messaggio
        <textarea rows={3} maxLength={300} value={testo} onChange={(e) => setTesto(e.target.value)}
          placeholder="Ciao bimbi, è ora di andare a scuola: mettete le scarpe e preparatevi. Buona giornata!" />
      </label>
      <p className="riga-meta">{testo.length}/300</p>
      <Volume etichetta="Volume" valore={volume} min={5} cambia={setVolume} />
      <div className="azioni">
        <button type="button" className="tasto-pieno" disabled={!pronta || lavora}
          onClick={() => salva({ data, ora, casse: scelte, testo: testo.trim(), volume })}>{lavora ? 'Preparo la voce…' : 'Salva messaggio'}</button>
        <button type="button" className="tasto-link" onClick={chiudi}>Annulla</button>
      </div>
      {passata && <p className="nota-piccola">Quest'ora oggi è già passata.</p>}
    </div>
  )
}

// Nuova sveglia: niente testo libero, solo le frasi standard (la frase decide anche la musica proposta).
function NuovaSveglia({ dati, salva, chiudi, lavora }) {
  const frasi = dati.frasi || []
  const casse = dati.casse?.length ? dati.casse : ['Bambini', 'Camera Mia']
  const [scelti, setScelti] = useState([])
  const [ora, setOra] = useState('07:00')
  const [cassa, setCassa] = useState(casse.includes('Bambini') ? 'Bambini' : casse[0])
  const [frase, setFrase] = useState(frasi[0]?.chiave)
  const [preferito, setPreferito] = useState(frasi[0]?.preferito || null)
  // Volumi di partenza come quelli scelti da Giovanni il 22.10: Camera Mia 15/5, Bambini 20/9.
  const [voce, setVoce] = useState(null)
  const [musicaVol, setMusicaVol] = useState(null)
  const camera = cassa === 'Camera Mia'
  const voceVista = voce ?? (camera ? 15 : 20)
  const musicaVista = musicaVol ?? (camera ? 5 : 9)
  useModifiche(scelti.length > 0)
  const cambiaGiorno = (g) => setScelti(scelti.includes(g) ? scelti.filter((x) => x !== g) : [...scelti, g].sort())
  const scegliFrase = (f) => {
    setFrase(f.chiave)
    setPreferito(f.preferito)
    if (f.per === 'giovanni' && casse.includes('Camera Mia')) setCassa('Camera Mia')
    if (f.per === 'bambini' && casse.includes('Bambini')) setCassa('Bambini')
  }
  const preferiti = [...new Set([...(dati.preferiti || []), ...(preferito ? [preferito] : [])])]
  const pronta = scelti.length > 0 && ora && cassa && frase
  return (
    <div className="scheda scheda-modulo nuova-sveglia">
      <h3>Nuova sveglia</h3>
      <p className="riga-meta">Giorni</p>
      <div className="chips">
        {[1, 2, 3, 4, 5, 6, 7].map((g) => (
          <button key={g} type="button" className={'chip' + (scelti.includes(g) ? ' attivo' : '')} aria-pressed={scelti.includes(g)}
            onClick={() => cambiaGiorno(g)}>{NOMI_GIORNI[g]}</button>
        ))}
      </div>
      <label className="campo">Ora<input type="time" value={ora} onChange={(e) => setOra(e.target.value)} /></label>
      <p className="riga-meta">Stanza</p>
      <div className="chips">
        {casse.map((c) => (
          <button key={c} type="button" className={'chip' + (cassa === c ? ' attivo' : '')} aria-pressed={cassa === c} onClick={() => setCassa(c)}>{c}</button>
        ))}
      </div>
      <p className="riga-meta">Frase</p>
      <div className="chips">
        {frasi.map((f) => (
          <button key={f.chiave} type="button" className={'chip' + (frase === f.chiave ? ' attivo' : '')} aria-pressed={frase === f.chiave}
            onClick={() => scegliFrase(f)}>{f.saluto}</button>
        ))}
      </div>
      <p className="riga-meta">Musica dopo la voce</p>
      <div className="chips">
        {preferiti.map((p) => (
          <button key={p} type="button" className={'chip' + (preferito === p ? ' attivo' : '')} aria-pressed={preferito === p} onClick={() => setPreferito(p)}>{musica(p)}</button>
        ))}
        <button type="button" className={'chip' + (!preferito ? ' attivo' : '')} aria-pressed={!preferito} onClick={() => setPreferito(null)}>Niente musica</button>
      </div>
      <Volume etichetta="Volume voce" valore={voceVista} min={5} cambia={setVoce} />
      {preferito && <Volume etichetta="Volume musica" valore={musicaVista} min={1} cambia={setMusicaVol} />}
      <div className="azioni">
        <button type="button" className="tasto-pieno" disabled={!pronta || lavora}
          onClick={() => salva({ giorni: scelti, ora, cassa, frase, preferito, volume_voce: voceVista, volume_musica: musicaVista })}>Salva sveglia</button>
        <button type="button" className="tasto-link" onClick={chiudi}>Annulla</button>
      </div>
      {!scelti.length && <p className="nota-piccola">Scegli almeno un giorno.</p>}
    </div>
  )
}
