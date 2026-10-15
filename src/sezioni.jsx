import { useState } from 'react'
import { quando } from './supabase'

// Sezioni nelle chat del Capo e degli agenti (15.10.2026, scelta di Giovanni): ogni argomento è una sezione.
// Le chiuse stanno in alto in una riga sola e si aprono con un tocco; quella aperta sta in fondo, sopra il riquadro per scrivere.
// Una sezione si chiude da sola 3 ore dopo l'ultima risposta (se nessuno ci lavora e non c'è niente da confermare),
// oppure subito con "Nuovo argomento". "Continua qui" la riapre: il messaggio dopo va lì.
// Nel database: richieste_agenti.sezione_id = la prima richiesta della sezione. La mette solo l'app:
// le richieste scritte da agenti e funzioni (Riordino, Smistatore, Capo) aprono sempre una sezione loro.

export const IN_ATTESA = ['nuova', 'avviata', 'in_corso']
const TRE_ORE = 3 * 3600 * 1000
const ms = (t) => (typeof t === 'number' ? t : t ? Date.parse(t) : 0)

// "Nuovo argomento" resta anche se chiudi l'app prima di scrivere.
function leggiChiusa(chiave) { try { return localStorage.getItem('sezione-chiusa:' + chiave) } catch { return null } }
function scriviChiusa(chiave, id) {
  try { if (id) localStorage.setItem('sezione-chiusa:' + chiave, id); else localStorage.removeItem('sezione-chiusa:' + chiave) } catch { /* niente */ }
}

// richieste in ordine di creata_il. piu(r) dice cosa c'è attorno a una richiesta (conferme, lavori passati):
// { attesa: qualcuno ci lavora, ferma: c'è da confermare, ultima: l'ultima cosa successa }.
export function useSezioni(chiave, richieste, piu = () => ({})) {
  const [aperte, setAperte] = useState(() => new Set())
  const [continua, setContinua] = useState(null)
  const [nuovo, setNuovo] = useState(false)
  const [chiusa, setChiusa] = useState(() => leggiChiusa(chiave))

  const mappa = new Map()
  for (const r of richieste || []) {
    const k = r.sezione_id || r.id
    if (!mappa.has(k)) mappa.set(k, { id: k, righe: [], ultima: 0, attesa: false, ferma: false })
    const s = mappa.get(k)
    const p = piu(r)
    s.righe.push(r)
    s.attesa = s.attesa || IN_ATTESA.includes(r.stato) || !!p.attesa
    s.ferma = s.ferma || !!p.ferma
    s.ultima = Math.max(s.ultima, ms(r.creata_il), ms(r.risposta_il), ms(p.ultima))
  }
  const tutte = [...mappa.values()].sort((a, b) => a.ultima - b.ultima)
  const ultima = tutte[tutte.length - 1]
  const attiva = continua ? mappa.get(continua) || null
    : nuovo || !ultima || ultima.id === chiusa ? null
      : ultima.attesa || ultima.ferma || Date.now() - ultima.ultima < TRE_ORE ? ultima : null

  return {
    attiva,
    altre: tutte.filter((s) => s !== attiva),
    // Chi lavora o aspetta una conferma resta sempre aperta.
    aperta: (s) => s.attesa || s.ferma || aperte.has(s.id),
    apri: (id) => setAperte((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n }),
    continuaQui: (id) => { setContinua(id); setNuovo(false); setChiusa(null); scriviChiusa(chiave, null) },
    nuovoArgomento: () => { setContinua(null); setNuovo(true); if (attiva) { setChiusa(attiva.id); scriviChiusa(chiave, attiva.id) } },
    // Da mettere in sezione_id del messaggio nuovo.
    sezioneId: attiva?.id || null,
    // Dopo l'invio (e dopo aver ricaricato): la sezione col messaggio nuovo è l'ultima, quindi resta aperta da sola.
    inviato: () => { setContinua(null); setNuovo(false) },
  }
}

// Una sezione non aperta in fondo: una riga che si apre con un tocco; dentro la chat e "Continua qui".
export function Sezione({ s, sez, titolo, onContinua, children }) {
  const aperta = sez.aperta(s)
  const prima = s.righe[0]
  const fine = s.righe[s.righe.length - 1]
  const stato = s.attesa ? 'ci sta lavorando' : s.ferma ? 'da confermare' : fine.stato === 'non_fatta' ? 'non fatto' : 'fatto'
  return (
    <section className={'sezione' + (aperta ? ' aperta' : '') + (s.attesa || s.ferma ? ' viva' : '')}>
      <button type="button" className="sezione-testa" onClick={() => sez.apri(s.id)} aria-expanded={aperta}>
        <span className="riga-corpo">
          <span className="riga-testo">{titolo(prima)}</span>
          <span className="riga-meta">{quando(prima.creata_il, true)}{s.righe.length > 1 && ` · ${s.righe.length} messaggi`} · {stato}</span>
        </span>
        <span className="sezione-freccia" aria-hidden="true">{aperta ? '▴' : '▾'}</span>
      </button>
      {aperta && (
        <div className="sezione-corpo">
          {children}
          {onContinua && <button type="button" className="tasto-link sezione-continua" onClick={() => onContinua(s.id)}>Continua qui</button>}
        </div>
      )}
    </section>
  )
}

// La chat si apre in fondo, sull'ultimo messaggio. Riprova per un attimo (i fumetti possono crescere mentre si disegnano);
// smette se tocchi lo schermo.
export function vaiInFondo() {
  const fino = Date.now() + 800
  let fermo = false
  const ferma = () => { fermo = true }
  window.addEventListener('touchstart', ferma, { passive: true })
  window.addEventListener('wheel', ferma, { passive: true })
  const prova = () => {
    if (!fermo) window.scrollTo(0, document.documentElement.scrollHeight)
    if (!fermo && Date.now() < fino) requestAnimationFrame(prova)
    else {
      window.removeEventListener('touchstart', ferma)
      window.removeEventListener('wheel', ferma)
    }
  }
  requestAnimationFrame(prova)
}
