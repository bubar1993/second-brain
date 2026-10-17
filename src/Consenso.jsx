import { useEffect, useState } from 'react'
import { sb } from './supabase'

// Pagina /oauth/consent: l'app Claude (connettore "Second Brain", solo lettura) chiede il permesso di leggere.
// Supabase manda qui con ?authorization_id=… dopo che Giovanni è entrato con l'impronta.
// Si accetta solo se si torna a claude.ai / claude.com: qualsiasi altro sito viene rifiutato.
const SITI_OK = ['claude.ai', 'claude.com']
const sitoOk = (url) => {
  try { const h = new URL(url).hostname; return SITI_OK.some((s) => h === s || h.endsWith('.' + s)) } catch { return false }
}

export default function Consenso() {
  const id = new URLSearchParams(location.search).get('authorization_id')
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(id ? null : 'Richiesta senza codice.')
  const [occupato, setOccupato] = useState(false)

  useEffect(() => {
    if (!id) return
    sb.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (error) return setErrore(error.message)
      // Già acconsentito prima: si torna subito a Claude (solo se è davvero Claude).
      if (data.redirect_url && !data.authorization_id) {
        if (sitoOk(data.redirect_url)) location.href = data.redirect_url
        else setErrore('Richiesta da un sito sconosciuto: rifiutata.')
        return
      }
      setDati(data)
    })
  }, [id])

  async function decidi(si) {
    setOccupato(true)
    const r = si && sitoOk(dati.redirect_uri)
      ? await sb.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await sb.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true })
    if (r.error) { setErrore(r.error.message); setOccupato(false); return }
    if (sitoOk(r.data.redirect_url)) location.href = r.data.redirect_url
    else location.href = '/'
  }

  const fidato = dati && sitoOk(dati.redirect_uri)
  return (
    <div className="schermata consenso">
      <h1>Collegare l'app Claude?</h1>
      {errore && <p className="msg rosso">{errore}</p>}
      {!errore && !dati && <p className="msg">Controllo la richiesta…</p>}
      {dati && (
        <>
          <p><b>{dati.client?.name || 'Un programma'}</b> chiede di <b>leggere</b> il tuo second brain:
            note, schede di ditte e persone, appuntamenti, promemoria, mail G&C e WhatsApp.</p>
          <p className="nota-piccola">Solo lettura: non può scrivere, cambiare o cancellare niente. Puoi scollegarlo quando vuoi dalle impostazioni dell'app Claude.</p>
          <p className="nota-piccola">Torna a: {new URL(dati.redirect_uri).hostname}</p>
          <p className="msg">Consenti solo se l'hai appena chiesto tu dall'app Claude. Se ti è arrivato un link da qualcuno: Rifiuta.</p>
          {!fidato && <p className="msg rosso">Questo indirizzo non è claude.ai: la richiesta non si può accettare.</p>}
          <div className="consenso-tasti">
            <button type="button" className="tasto-grande" disabled={occupato || !fidato} onClick={() => decidi(true)}>Consenti</button>
            <button type="button" className="tasto-piccolo" disabled={occupato} onClick={() => decidi(false)}>Rifiuta</button>
          </div>
        </>
      )}
    </div>
  )
}
