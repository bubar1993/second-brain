import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './stile.css'

// "Condividi" da un'altra app arriva come /aggiungi?title=…&text=…&url=…
function leggiCondiviso() {
  const p = new URLSearchParams(location.search)
  if (location.pathname !== '/aggiungi' && !p.has('text') && !p.has('url')) return null
  const testo = [p.get('title'), p.get('text'), p.get('url')]
    .filter(Boolean)
    .filter((v, i, tutti) => tutti.indexOf(v) === i)
    .join('\n')
  history.replaceState(null, '', '/#/aggiungi')
  return testo ? { testo } : null
}

const condiviso = leggiCondiviso()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App condiviso={condiviso} />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
