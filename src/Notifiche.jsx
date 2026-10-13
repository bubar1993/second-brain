import { useEffect, useState } from 'react'
import { sb, leggi, scrivi, quando } from './supabase'
import { useApp, useCarica, chk, messaggioErrore, Stato, Indietro } from './componenti'

// Notifiche sul telefono (13.10.2026, scelte di Giovanni): appuntamenti di lavoro e privati 1 ora prima,
// promemoria all'ora (dal 14.10.2026 tutti), risposte e conferme del Capo. Le manda la funzione "notifiche" ogni 5 minuti.
// Chiave pubblica VAPID (la privata sta solo nei segreti di Supabase).
const VAPID = 'BPiU1Voq6q5lksjvnYPYwDeHPkciCS8quW6M7IF5HBJjw_MGjgJ5RY8XcwI4nY0bJ3mMRjGPBZZOvTGAUdIda-o'

const supportate = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const chiave = () => Uint8Array.from(atob(VAPID.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function iscrizioneAttuale() {
  if (!supportate()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

function nomeDispositivo() {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'Telefono Android'
  if (/iphone|ipad/i.test(ua)) return 'iPhone'
  if (/windows/i.test(ua)) return 'PC Windows'
  return 'Questo dispositivo'
}

async function iscrivi() {
  const permesso = await Notification.requestPermission()
  if (permesso !== 'granted') throw new Error('Permesso negato: sbloccalo dalle impostazioni del telefono (Notifiche dell\'app)')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiave() })
  const j = sub.toJSON()
  chk(await sb.from('push_iscrizioni').upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, dispositivo: nomeDispositivo(), errore: null },
    { onConflict: 'endpoint' },
  ))
}

async function togli() {
  const sub = await iscrizioneAttuale()
  if (!sub) return
  chk(await sb.from('push_iscrizioni').delete().eq('endpoint', sub.endpoint))
  await sub.unsubscribe()
}

// In Oggi: "Attiva le notifiche", finché non sono attive su questo telefono (o dici "Più tardi").
export function AttivaNotifiche() {
  const { avvisa } = useApp()
  const [mostra, setMostra] = useState(false)
  const [lavoro, setLavoro] = useState(false)

  useEffect(() => {
    if (!supportate() || Notification.permission === 'denied' || leggi('notifiche-rimandate') === '1') return
    iscrizioneAttuale().then((s) => setMostra(!s)).catch(() => {})
  }, [])

  async function attiva() {
    setLavoro(true)
    try {
      await iscrivi()
      setMostra(false)
      avvisa('Notifiche attive su questo telefono')
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  if (!mostra) return null
  return (
    <div className="scheda scheda-impronta">
      <p>Attivo le notifiche su questo telefono? Ti avviso 1 ora prima degli appuntamenti, all'ora dei promemoria e quando risponde il Capo.</p>
      <div className="azioni">
        <button type="button" className="tasto-pieno" onClick={attiva} disabled={lavoro}>Attiva</button>
        <button type="button" className="tasto-link" onClick={() => { scrivi('notifiche-rimandate', '1'); setMostra(false) }}>Più tardi</button>
      </div>
    </div>
  )
}

const COSA = { appuntamento: 'Appuntamento', promemoria: 'Promemoria', capo_risposta: 'Capo', capo_conferma: 'Capo' }

// Dentro → Notifiche: se sono attive qui, i telefoni iscritti e le ultime mandate.
export function Notifiche() {
  const { avvisa } = useApp()
  const [qui, setQui] = useState(undefined)
  const [lavoro, setLavoro] = useState(false)
  const { dati, errore, carica, ricarica } = useCarica(async () => {
    const [iscrizioni, mandate] = await Promise.all([
      sb.from('push_iscrizioni').select('id,endpoint,dispositivo,creata_il,ultima_ok,errore').order('creata_il'),
      sb.from('notifiche_inviate').select('id,tipo,titolo,inviata_il').order('inviata_il', { ascending: false }).limit(15),
    ])
    return { iscrizioni: chk(iscrizioni), mandate: chk(mandate) }
  }, [])

  useEffect(() => { iscrizioneAttuale().then((s) => setQui(s?.endpoint || null)).catch(() => setQui(null)) }, [dati])

  async function cambia(accendi) {
    setLavoro(true)
    try {
      if (accendi) await iscrivi()
      else await togli()
      scrivi('notifiche-rimandate', '')
      avvisa(accendi ? 'Notifiche attive su questo telefono' : 'Notifiche spente su questo telefono')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    } finally {
      setLavoro(false)
    }
  }

  async function toglieAltro(i) {
    try {
      chk(await sb.from('push_iscrizioni').delete().eq('id', i.id))
      avvisa('Tolto')
      ricarica()
    } catch (e) {
      avvisa(messaggioErrore(e))
    }
  }

  const attiveQui = !!qui && dati?.iscrizioni.some((i) => i.endpoint === qui)
  return (
    <div className="schermata">
      <Indietro titolo="Notifiche" />
      <p className="nota-piccola">Ti avviso 1 ora prima degli appuntamenti (lavoro e privati), per i promemoria all'ora giusta, e quando il Capo risponde o chiede una conferma. Niente altro.</p>
      {!supportate() ? (
        <p className="msg">Questo browser non riceve notifiche. Apri l'app installata sul telefono.</p>
      ) : Notification.permission === 'denied' ? (
        <p className="msg">Le notifiche sono bloccate per l'app. Sbloccale dalle impostazioni del telefono: Impostazioni → App → Second Brain → Notifiche.</p>
      ) : (
        <div className="scheda">
          <span>{attiveQui ? 'Attive su questo telefono' : 'Spente su questo telefono'}</span>
          <button type="button" className={attiveQui ? 'tasto-link' : 'tasto-pieno'} disabled={lavoro || qui === undefined} onClick={() => cambia(!attiveQui)}>
            {attiveQui ? 'Spegni' : 'Attiva'}
          </button>
        </div>
      )}
      <Stato carica={carica} errore={errore}>
        {dati && (
          <>
            {dati.iscrizioni.length > 0 && (
              <>
                <h2>Dove arrivano</h2>
                <div className="elenco">
                  {dati.iscrizioni.map((i) => (
                    <div key={i.id} className="riga">
                      <span className="riga-corpo">
                        <span className="riga-testo">{i.dispositivo || 'Dispositivo'}{i.endpoint === qui ? ' (questo)' : ''}</span>
                        <span className="riga-meta">
                          {i.errore ? <span className="rosso">Problema: {i.errore}</span> : i.ultima_ok ? `Ultima arrivata ${quando(i.ultima_ok, true)}` : `Attivate ${quando(i.creata_il, true)}`}
                        </span>
                      </span>
                      {i.endpoint !== qui && <button type="button" className="tasto-link" onClick={() => toglieAltro(i)}>Togli</button>}
                    </div>
                  ))}
                </div>
              </>
            )}
            {dati.mandate.length > 0 && (
              <>
                <h2>Ultime mandate</h2>
                <div className="elenco">
                  {dati.mandate.map((m) => (
                    <div key={m.id} className="riga">
                      <span className="riga-corpo">
                        <span className="riga-testo">{m.titolo}</span>
                        <span className="riga-meta">{COSA[m.tipo]} · {quando(m.inviata_il, true)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Stato>
    </div>
  )
}
