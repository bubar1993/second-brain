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

// Notifiche (funzione "notifiche"): appuntamenti 1 ora prima, promemoria urgenti, risposte del Capo.
self.addEventListener('push', (e) => {
  let m = {}
  try { m = e.data ? e.data.json() : {} } catch { m = { titolo: e.data?.text() } }
  e.waitUntil(self.registration.showNotification(m.titolo || 'Second Brain', {
    body: m.corpo || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: m.tag,
    data: { url: m.url || '/#/oggi' },
  }))
})

// Tocco sulla notifica: apre l'app (se è già aperta la porta lì) sulla pagina giusta.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/#/oggi', self.location.origin).href
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((finestre) => {
    for (const f of finestre) {
      if (new URL(f.url).origin === self.location.origin && 'focus' in f) {
        return f.navigate(url).then((x) => (x || f).focus()).catch(() => f.focus())
      }
    }
    return self.clients.openWindow(url)
  }))
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
