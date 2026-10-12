// Service worker: tiene in memoria l'app per aprirla subito anche con rete debole.
// I dati (Supabase) non passano di qui: arrivano sempre freschi dalla rete.
const CACHE = 'second-brain-v1'
const GUSCIO = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(GUSCIO)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  // Controllo "c'è una versione nuova?": sempre e solo dalla rete.
  if (url.searchParams.has('versione')) return

  // Pagine: prima la rete (versione nuova), se manca la rete la copia salvata.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone()
          caches.open(CACHE).then((c) => c.put('/', copia))
          return r
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // File dell'app (nomi con impronta, non cambiano mai): prima la copia salvata.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((salvato) => salvato || fetch(req).then((r) => {
        const copia = r.clone()
        caches.open(CACHE).then((c) => c.put(req, copia))
        return r
      })),
    )
    return
  }

  // Il resto: copia salvata subito, aggiornata in sottofondo.
  e.respondWith(
    caches.match(req).then((salvato) => {
      const dallaRete = fetch(req).then((r) => {
        const copia = r.clone()
        caches.open(CACHE).then((c) => c.put(req, copia))
        return r
      }).catch(() => salvato)
      return salvato || dallaRete
    }),
  )
})
