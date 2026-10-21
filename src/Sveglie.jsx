import { useState } from 'react'
import { useApp, useCarica, chiama, messaggioErrore, Stato, Indietro, useModifiche } from './componenti'

// Sveglie Sonos (Privato, 21.10.2026, scelte di Giovanni): le 4 sveglie del mattino (ora, acceso/spento) e il tasto
// rapido "Alessia non c'è questa settimana" (giovedì e venerdì come lunedì–mercoledì; la settimana dopo torna normale).
// Tutto passa dalla funzione `sonos`: le tabelle delle sveglie l'app non le vede.

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
  return new Date(`${d}T12:00`).toLocaleDateString('it-CH', { weekday: 'long', day: 'numeric', month: 'numeric' })
}
const musica = (p) => (p || '').replace(/^this is\s+/i, '')

export function Sveglie() {
  const { avvisa } = useApp()
  const [aperta, setAperta] = useState(null)
  const [lavora, setLavora] = useState(false)
  const { dati, errore, carica, ricarica } = useCarica(() => chiama('sonos', { azione: 'sveglie_elenco' }), [])

  async function fai(corpo, messaggio) {
    setLavora(true)
    try {
      await chiama('sonos', corpo)
      avvisa(messaggio)
      setAperta(null)
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
                          aria-expanded={aperta === s.id} aria-label={`Cambia l'ora, adesso ${s.ora.slice(0, 5)}`}>
                          {s.ora.slice(0, 5)}
                        </button>
                        <div className="riga-corpo">
                          <span className="riga-testo">{giorni(s.giorni)} · «{s.saluto}»</span>
                          <span className="riga-meta">{[s.notizie || s.per === 'giovanni' ? 'meteo, battuta e notizie' : 'canzoncina, meteo e indovinello',
                            s.preferito && `poi ${musica(s.preferito)}`].filter(Boolean).join(' · ')}</span>
                          {s.errore && <span className="riga-meta rosso">Ultima volta: {s.errore}</span>}
                        </div>
                        <label className="sveglia-accesa">
                          <input type="checkbox" checked={s.attiva} disabled={lavora}
                            onChange={() => fai({ azione: 'sveglia_cambia', id: s.id, attiva: !s.attiva }, s.attiva ? 'Sveglia spenta' : 'Sveglia accesa')} />
                          <span>{s.attiva ? 'Accesa' : 'Spenta'}</span>
                        </label>
                      </div>
                      {aperta === s.id && (
                        <CambiaOra s={s} lavora={lavora} chiudi={() => setAperta(null)}
                          salva={(ora) => fai({ azione: 'sveglia_cambia', id: s.id, ora }, `Sveglia alle ${ora}`)} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <p className="nota-piccola">Nei giorni di scuola chiusa le sveglie non suonano. Volume: voce 25, musica 15.</p>
          </>
        )}
      </Stato>
    </div>
  )
}

function CambiaOra({ s, salva, chiudi, lavora }) {
  const [ora, setOra] = useState(s.ora.slice(0, 5))
  const cambiato = ora !== s.ora.slice(0, 5)
  useModifiche(cambiato)
  return (
    <div className="modifica-promemoria">
      <label className="campo">Nuova ora<input type="time" value={ora} onChange={(e) => setOra(e.target.value)} /></label>
      <div className="azioni">
        {cambiato && ora && <button type="button" className="tasto-piccolo tasto-salva" disabled={lavora} onClick={() => salva(ora)}>Salva</button>}
        <button type="button" className="tasto-link" onClick={chiudi}>Chiudi</button>
      </div>
    </div>
  )
}
