// Worker dell'app Second Brain: serve i file dell'app (dist) e, su /api/vettori, calcola i "vettori"
// (il significato in numeri) dei testi con il modello multilingue bge-m3 di Cloudflare Workers AI.
// Lo chiama solo la funzione Supabase "significato", con il segreto VETTORI_TOKEN (13.10.2026).
const MODELLO = '@cf/baai/bge-m3'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/vettori') return env.ASSETS.fetch(request)
    if (request.method !== 'POST') return Response.json({ errore: 'Usa POST' }, { status: 405 })
    if (!env.VETTORI_TOKEN || request.headers.get('x-vettori-token') !== env.VETTORI_TOKEN) {
      return Response.json({ errore: 'Non autorizzato' }, { status: 401 })
    }
    const { testi } = await request.json().catch(() => ({}))
    if (!Array.isArray(testi) || !testi.length || testi.length > 50 || testi.some((t) => typeof t !== 'string')) {
      return Response.json({ errore: 'Servono da 1 a 50 testi' }, { status: 400 })
    }
    try {
      const r = await env.AI.run(MODELLO, { text: testi.map((t) => t.slice(0, 8000) || ' ') })
      return Response.json({ vettori: r.data })
    } catch (e) {
      return Response.json({ errore: String(e?.message || e) }, { status: 502 })
    }
  },
}
