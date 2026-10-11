import { useState } from 'react'
import { sb, leggi, scrivi } from './supabase'

// Entrata: impronta/volto se già attivata, altrimenti codice via email (solo per utenti già esistenti).
export default function Accesso() {
  const [email, setEmail] = useState(leggi('ultima-email') || '')
  const [fase, setFase] = useState('email')
  const [codice, setCodice] = useState('')
  const [msg, setMsg] = useState('')
  const [lavoro, setLavoro] = useState(false)
  const conImpronta = leggi('impronta-attiva') === '1' && !!window.PublicKeyCredential

  async function entraConImpronta() {
    setLavoro(true)
    setMsg('')
    const { error } = await sb.auth.signInWithPasskey()
    setLavoro(false)
    if (error) setMsg('Impronta non riuscita. Riprova oppure usa il codice via email.')
  }

  async function inviaCodice(e) {
    e.preventDefault()
    setLavoro(true)
    setMsg('')
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    })
    setLavoro(false)
    if (error) return setMsg('Non riesco a mandare il codice. Controlla l\'indirizzo e riprova tra un minuto.')
    scrivi('ultima-email', email.trim())
    setFase('codice')
  }

  async function verifica(e) {
    e.preventDefault()
    setLavoro(true)
    setMsg('')
    const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: codice.trim(), type: 'email' })
    setLavoro(false)
    if (error) setMsg('Codice sbagliato o scaduto.')
  }

  return (
    <div className="accesso">
      <div className="logo" aria-hidden="true">
        <span style={{ background: '#2563eb' }} />
        <span style={{ background: '#16a34a' }} />
        <span style={{ background: '#ea580c' }} />
      </div>
      <h1>Second Brain</h1>

      {conImpronta && fase === 'email' && (
        <>
          <button type="button" className="tasto-grande" onClick={entraConImpronta} disabled={lavoro}>
            Entra con impronta o volto
          </button>
          <p className="oppure">oppure</p>
        </>
      )}

      {fase === 'email' ? (
        <form onSubmit={inviaCodice}>
          <label htmlFor="email">La tua email</label>
          <input id="email" type="email" required value={email} autoComplete="email"
            inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className={conImpronta ? 'tasto-secondario' : 'tasto-grande'} disabled={lavoro}>
            {lavoro ? 'Invio…' : 'Mandami il codice'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifica}>
          <label htmlFor="codice">Codice arrivato a {email}</label>
          <input id="codice" type="text" required value={codice} inputMode="numeric"
            autoComplete="one-time-code" maxLength={6} className="codice" autoFocus
            onChange={(e) => setCodice(e.target.value.replace(/\D/g, ''))} />
          <button type="submit" className="tasto-grande" disabled={lavoro || codice.length < 6}>
            {lavoro ? 'Controllo…' : 'Entra'}
          </button>
          <button type="button" className="tasto-link" onClick={() => { setFase('email'); setCodice('') }}>
            Rimanda il codice
          </button>
        </form>
      )}

      {msg && <p className="msg errore">{msg}</p>}
    </div>
  )
}
