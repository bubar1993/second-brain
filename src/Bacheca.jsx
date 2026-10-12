import { AREE } from './supabase'
import { Indietro } from './componenti'

// Bacheca (13.10.2026, second-brain…/bacheca o #/bacheca): chi parla con chi, in un disegno solo.
// Il Capo può passare lavoro a tutti; lo Smistatore a tutti tranne il Privato; gli agenti con un dubbio scrivono
// in "Domande per te" e lo Smistatore legge le risposte. Ogni nodo si tocca e apre la sua schermata.

const COLORE = Object.fromEntries(AREE.map((a) => [a.codice, a.colore]))
const CAPO = '#ffd666'
const SMISTA = '#b9c1e6'

const TU = { x: 92, y: 46 }
const DOMANDE = { x: 268, y: 46 }
const NCAPO = { x: 92, y: 150 }
const NSMISTA = { x: 268, y: 150 }
const AGENTI = [
  { codice: 'lavoro', nome: 'Lavoro', x: 46, y: 290, aree: ['C', 'G'] },
  { codice: 'ceramex', nome: 'Ceramex', x: 136, y: 290, aree: ['C'] },
  { codice: 'gc', nome: 'G&C', x: 224, y: 290, aree: ['G'] },
  { codice: 'archiviazione', nome: 'Archiviazione', x: 314, y: 290, aree: ['G'] },
  { codice: 'calendario', nome: 'Calendario', x: 76, y: 390, aree: ['C', 'G', 'P'] },
  { codice: 'seguire', nome: 'Da seguire', x: 180, y: 390, aree: ['C', 'G'] },
  { codice: 'privato', nome: 'Privato', x: 284, y: 390, aree: ['P'] },
]
const DA_SOLI = [
  { codice: 'ordini', nome: 'Ordini Marazzi' },
  { codice: 'liste', nome: 'Liste di carico' },
  { codice: 'fornitori', nome: 'Completa fornitori' },
]

function Nodo({ x, y, nome, href, colori, grande }) {
  const r = grande ? 15 : 10
  return (
    <a href={href} className="bacheca-nodo">
      <circle cx={x} cy={y} r={r + 9} className="alone" style={{ fill: colori[0] }} />
      <circle cx={x} cy={y} r={r} style={{ fill: colori[0] }} />
      {colori.slice(1).map((c, i) => <circle key={c} cx={x + (i ? 1 : -1) * (r - 2)} cy={y - r + 2} r={4} style={{ fill: c }} />)}
      <text x={x} y={y + r + 16} textAnchor="middle">{nome}</text>
    </a>
  )
}

export function Bacheca() {
  return (
    <div className="schermata bacheca">
      <Indietro titolo="Chi parla con chi" />
      <p className="nota-piccola">Tocca un agente per aprirlo. Tu puoi scrivere a ognuno dalla schermata Agenti.</p>

      <div className="bacheca-tela">
        <svg viewBox="0 0 360 440" role="img" aria-label="Il Capo passa lavoro a tutti gli agenti; lo Smistatore a tutti tranne il Privato; gli agenti con un dubbio ti scrivono in Domande per te.">
          {/* Capo → tutti */}
          {AGENTI.map((a) => <line key={`c${a.codice}`} x1={NCAPO.x} y1={NCAPO.y} x2={a.x} y2={a.y} className="filo filo-capo" style={{ stroke: CAPO }} />)}
          <line x1={NCAPO.x} y1={NCAPO.y} x2={NSMISTA.x} y2={NSMISTA.y} className="filo filo-capo" style={{ stroke: CAPO }} />
          {/* Smistatore → tutti tranne il Privato */}
          {AGENTI.filter((a) => a.codice !== 'privato').map((a) => <line key={`s${a.codice}`} x1={NSMISTA.x} y1={NSMISTA.y} x2={a.x} y2={a.y} className="filo" style={{ stroke: SMISTA }} />)}
          {/* Tu ↔ Capo, Tu ↔ Domande, Domande → Smistatore */}
          <line x1={TU.x} y1={TU.y} x2={NCAPO.x} y2={NCAPO.y} className="filo filo-forte" style={{ stroke: CAPO }} />
          <line x1={TU.x} y1={TU.y} x2={DOMANDE.x} y2={DOMANDE.y} className="filo filo-domande" />
          <line x1={DOMANDE.x} y1={DOMANDE.y} x2={NSMISTA.x} y2={NSMISTA.y} className="filo filo-domande" />

          <Nodo {...TU} nome="Tu" href="#/oggi" colori={['#eceef6']} grande />
          <Nodo {...DOMANDE} nome="Domande per te" href="#/domande" colori={['#eceef6']} />
          <Nodo {...NCAPO} nome="Capo" href="#/capo" colori={[CAPO]} grande />
          <Nodo {...NSMISTA} nome="Smistatore" href="#/agente/smistatore" colori={[SMISTA]} />
          {AGENTI.map((a) => (
            <Nodo key={a.codice} x={a.x} y={a.y} nome={a.nome} href={`#/agente/${a.codice}`} colori={a.aree.map((c) => COLORE[c])} />
          ))}
        </svg>
      </div>

      <ul className="bacheca-legenda">
        <li><span className="segno" style={{ background: CAPO }} />Il <b>Capo</b> passa il lavoro a tutti, anche al Privato, e lo fa partire subito.</li>
        <li><span className="segno" style={{ background: SMISTA }} />Lo <b>Smistatore</b> passa il lavoro a tutti tranne il Privato.</li>
        <li><span className="segno tratteggio" />Se un agente ha un dubbio ti scrive in <b>Domande per te</b>: lo Smistatore legge le tue risposte.</li>
        <li><span className="segno" style={{ background: COLORE.C }} /><span className="segno" style={{ background: COLORE.G }} /><span className="segno" style={{ background: COLORE.P }} />Il colore del pallino dice l'area: Ceramex, G&C, Privato.</li>
      </ul>

      <h2>Lavorano da soli</h2>
      <p className="nota-piccola">Fanno solo il loro lavoro e non ricevono richieste:{' '}
        {DA_SOLI.map((a, i) => <span key={a.codice}>{i > 0 && ', '}<a href={`#/agente/${a.codice}`}>{a.nome}</a></span>)}.
      </p>
    </div>
  )
}
