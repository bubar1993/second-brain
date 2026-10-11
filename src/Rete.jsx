import { useEffect, useImperativeHandle, useRef } from 'react'

// La rete neurale di Oggi: le cose aperte sono neuroni su un anello 3D intorno al giorno.
// Ruota da sola, si gira col dito (con inerzia), i segnali corrono verso il centro.
// nodi: [{ id, area: 'C'|'G'|'P'|null, etichetta, tipo: 'promemoria'|'nota'|'azienda' }] (solo i promemoria sono neuroni pieni)
// ref.assorbi(id): il nodo viene risucchiato nel centro (promemoria fatto).

const COL = { C: '#5b93ff', G: '#34d58a', P: '#ff8f45', '': '#c9cde0' }
const INCLINA = 0.62
const CI = Math.cos(INCLINA)
const SI = Math.sin(INCLINA)
const BASE = 0.00011
const easeEsci = (x) => 1 - Math.pow(1 - x, 5)
const easeMuovi = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

function creaSprite(col) {
  const s = document.createElement('canvas')
  const r = 32
  s.width = s.height = r * 2
  const c = s.getContext('2d')
  const gr = c.createRadialGradient(r, r, 0, r, r, r)
  gr.addColorStop(0, col)
  gr.addColorStop(0.25, col + 'aa')
  gr.addColorStop(1, col + '00')
  c.fillStyle = gr
  c.fillRect(0, 0, r * 2, r * 2)
  return s
}

// Differenza tra due angoli, sempre dalla parte più corta.
const diffAng = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

export default function Rete({ nodi, onTocca, ref }) {
  const tela = useRef(null)
  const motore = useRef(null)

  // Il motore vive fuori da React: niente render a ogni fotogramma.
  useEffect(() => {
    const cv = tela.current
    const ctx = cv.getContext('2d')
    const fermo = matchMedia('(prefers-reduced-motion: reduce)').matches
    const sprite = Object.fromEntries(Object.entries(COL).map(([k, c]) => [k, creaSprite(c)]))
    sprite.bianco = creaSprite('#dfe5ff')

    let W = 0, H = 0, cx = 0, cy = 0, R = 0
    let rot = 0.4, vel = BASE, tPrima = performance.now()
    let dito = null, trascino = null, scelto = null, sceltoT = 0, lampoT = -9999
    const t0 = performance.now()
    const vivi = []
    const polvere = Array.from({ length: 70 }, () => {
      const k = ['C', 'G', 'P', '', '', 'C', 'C'][Math.floor(Math.random() * 7)]
      const a = Math.random() * Math.PI * 2
      const u = Math.random() * 2 - 1
      const d = 0.35 + Math.random() * 0.9
      const q = Math.sqrt(1 - u * u)
      return { x: Math.cos(a) * q * d, y: u * d * 0.75, z: Math.sin(a) * q * d, k, r: 0.8 + Math.random() * 1.3, ox: 0, oy: 0, f: Math.random() * 6 }
    })

    function misura() {
      const r = cv.getBoundingClientRect()
      const dpr = Math.min(devicePixelRatio || 1, 2)
      W = r.width
      H = r.height
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cx = W / 2
      cy = H * 0.56
      // Sul telefono resta 150 al massimo; sul PC la rete è più alta e cresce.
      R = Math.min(W * 0.31, Math.max(150, H * 0.3), 260)
    }

    function proietta(x, y, z) {
      const cr = Math.cos(rot), sr = Math.sin(rot)
      const x1 = x * cr - z * sr, z1 = x * sr + z * cr
      const y2 = y * CI - z1 * SI, z2 = y * SI + z1 * CI
      const s = 1 / (1 + z2 / (R * 3.2))
      return { x: cx + x1 * s, y: cy + y2 * s, s, z: z2 }
    }
    function suAnello(n, t) {
      const y = fermo ? 0 : Math.sin(t * 0.0009 + n.fase) * 10
      return proietta(Math.cos(n.ang) * R, y, Math.sin(n.ang) * R)
    }
    function posNodo(n, t) {
      if (n.dentro) {
        const k = Math.min(1, (t - n.dentro.t) / 650)
        const e = easeMuovi(k)
        return { x: n.dentro.x + (cx - n.dentro.x) * e, y: n.dentro.y + (cy - n.dentro.y) * e, s: 1, z: 0, k }
      }
      return suAnello(n, t)
    }
    const controllo = (a, b) => ({ x: (a.x + b.x) / 2 - (b.y - a.y) * 0.22, y: (a.y + b.y) / 2 + (b.x - a.x) * 0.22 })
    function punto(a, c, b, s) {
      const u = 1 - s
      return { x: u * u * a.x + 2 * u * s * c.x + s * s * b.x, y: u * u * a.y + 2 * u * s * c.y + s * s * b.y }
    }

    function disegna(t) {
      const dt = Math.min(48, t - tPrima)
      tPrima = t
      if (!fermo && !trascino) { rot += vel * dt; vel += (BASE - vel) * 0.03 }
      const intro = fermo ? 1 : easeEsci(Math.min(1, (t - t0) / 1400))
      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'

      // radar intorno al giorno
      if (typeof ctx.createConicGradient === 'function') {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(1, CI)
        const cg = ctx.createConicGradient(fermo ? 0 : t * 0.0011, 0, 0)
        cg.addColorStop(0, 'rgba(140,170,255,0)')
        cg.addColorStop(0.86, 'rgba(140,170,255,0)')
        cg.addColorStop(0.995, 'rgba(160,190,255,0.22)')
        cg.addColorStop(1, 'rgba(140,170,255,0)')
        ctx.globalAlpha = intro
        ctx.fillStyle = cg
        ctx.beginPath(); ctx.arc(0, 0, R * 1.05, 0, 7); ctx.fill()
        ctx.restore()
      }
      // anello con tacche
      ctx.strokeStyle = 'rgba(190,200,255,0.35)'
      ctx.lineWidth = 1
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2
        const l = i % 6 === 0 ? 7 : 3
        const p1 = proietta(Math.cos(a) * R, 0, Math.sin(a) * R)
        const p2 = proietta(Math.cos(a) * (R + l), 0, Math.sin(a) * (R + l))
        ctx.globalAlpha = (0.15 + (0.35 * (p1.s - 0.75)) / 0.5) * intro
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()
      }

      // nube di neuroni
      const pts = polvere.map((p) => {
        const j = fermo ? 0 : Math.sin(t * 0.0005 + p.f) * 0.02
        const q = proietta((p.x + j) * R * 1.15, (p.y - j) * R, p.z * R * 1.15)
        if (!fermo && dito) {
          const dx = q.x + p.ox - dito.x, dy = q.y + p.oy - dito.y, d = Math.hypot(dx, dy) || 1
          if (d < 80) { p.ox += (dx / d) * (80 - d) * 0.05; p.oy += (dy / d) * (80 - d) * 0.05 }
        }
        p.ox *= 0.93
        p.oy *= 0.93
        return { x: q.x + p.ox, y: q.y + p.oy, s: q.s, k: p.k, r: p.r }
      })
      ctx.lineWidth = 0.6
      ctx.strokeStyle = '#aab9ff'
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d < 58) {
            ctx.globalAlpha = (1 - d / 58) * 0.22 * intro * Math.min(a.s, b.s)
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
          }
        }
      }
      for (const p of pts) {
        ctx.globalAlpha = Math.max(0.15, (p.s - 0.7) * 1.6) * intro
        ctx.fillStyle = COL[p.k]
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.s, 0, 7); ctx.fill()
      }

      // nucleo
      const nucleo = { x: cx, y: cy }
      const lampo = Math.max(0, 1 - (t - lampoT) / 700)
      const respiro = fermo ? 1 : 1 + Math.sin(t * 0.0015) * 0.04
      const RN = 115 * respiro * (1 + lampo * 0.3)
      ctx.globalAlpha = (0.32 + lampo * 0.6) * intro
      ctx.drawImage(sprite.bianco, cx - RN, cy - RN, RN * 2, RN * 2)
      if (lampo > 0) {
        const r = 40 + (1 - lampo) * 120
        ctx.globalAlpha = lampo * 0.8
        ctx.strokeStyle = '#dfe5ff'
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.ellipse(cx, cy, r, r * CI, 0, 0, 7); ctx.stroke()
      }

      // neuroni: gli angoli si ridistribuiscono piano quando cambia il numero
      const attivi = vivi.filter((n) => !n.via)
      attivi.forEach((n, i) => {
        n.meta = (i / Math.max(1, attivi.length)) * Math.PI * 2 + 0.5
        n.ang += diffAng(n.ang, n.meta) * (fermo ? 1 : 0.05)
      })
      const ordinati = vivi.map((n) => ({ n, p: posNodo(n, t) })).sort((a, b) => b.p.z - a.p.z)
      for (const { n, p } of ordinati) {
        n.alfa += ((n.via ? 0 : 1) - n.alfa) * (fermo ? 1 : 0.1)
        if (n.dentro && p.k >= 1) { n.morto = true; lampoT = t; continue }
        if (n.via && n.alfa < 0.02) { n.morto = true; continue }
        const col = COL[n.area || '']
        const nota = n.tipo !== 'promemoria'
        const prof = Math.max(0.35, Math.min(1.2, (p.s - 0.72) * 1.9))
        const a = n.alfa * intro * prof * (n.dentro ? 1 - p.k : 1) * (nota ? 0.75 : 1)
        const c = controllo(p, nucleo)
        // filo
        ctx.globalAlpha = 0.55 * a
        const gr = ctx.createLinearGradient(p.x, p.y, cx, cy)
        gr.addColorStop(0, col)
        gr.addColorStop(1, 'rgba(220,226,255,0.1)')
        ctx.strokeStyle = gr
        ctx.lineWidth = 1.3 * p.s
        if (nota) ctx.setLineDash([3, 5])
        ctx.beginPath(); ctx.moveTo(p.x, p.y)
        for (let s = 1; s <= 28; s++) { const q = punto(p, c, nucleo, (s / 28) * intro); ctx.lineTo(q.x, q.y) }
        ctx.stroke()
        ctx.setLineDash([])
        // segnale verso il centro
        if (!fermo && !n.dentro) {
          n.seg += n.vel * dt
          if (n.seg > 1.35) n.seg = 0
          if (n.seg <= 1) {
            const q = punto(p, c, nucleo, easeMuovi(n.seg))
            ctx.globalAlpha = a * Math.sin(n.seg * Math.PI)
            ctx.drawImage(sprite[n.area || ''], q.x - 11, q.y - 11, 22, 22)
          }
        }
        // nodo
        const sel = scelto === n.id ? Math.max(0, 1 - (t - sceltoT) / 900) : 0
        const r = ((nota ? 18 : 26) + sel * 18) * p.s
        ctx.globalAlpha = a
        ctx.drawImage(sprite[n.area || ''], p.x - r, p.y - r, r * 2, r * 2)
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = col
        ctx.beginPath(); ctx.arc(p.x, p.y, (nota ? 3.5 : 5) * p.s, 0, 7); ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 * p.s, 0, 7); ctx.fill()
        if (sel > 0) {
          ctx.globalAlpha = a * sel
          ctx.strokeStyle = col
          ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.arc(p.x, p.y, 8 + (1 - sel) * 26, 0, 7); ctx.stroke()
        }
        if (!n.dentro) {
          ctx.globalAlpha = a * 0.92
          ctx.font = `${nota ? 400 : 500} ${Math.round((nota ? 10 : 11) + p.s * 2)}px Geist, system-ui, sans-serif`
          ctx.fillStyle = '#dde1f2'
          // etichetta di lato; se uscirebbe dallo schermo, sotto il nodo
          const sx = p.x < cx
          const w = ctx.measureText(n.etichetta).width
          if ((sx && p.x - 12 - w < 4) || (!sx && p.x + 12 + w > W - 4)) {
            ctx.textAlign = 'center'
            ctx.fillText(n.etichetta, Math.min(W - 4 - w / 2, Math.max(4 + w / 2, p.x)), p.y + 20)
          } else {
            ctx.textAlign = sx ? 'right' : 'left'
            ctx.fillText(n.etichetta, p.x + (sx ? -12 : 12), p.y + 4)
          }
        }
        ctx.globalCompositeOperation = 'lighter'
      }
      for (let i = vivi.length - 1; i >= 0; i--) if (vivi[i].morto) vivi.splice(i, 1)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }

    // Dito: trascina per ruotare, tocca un nodo.
    const locale = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    function giu(e) {
      const q = locale(e), t = performance.now()
      dito = q
      trascino = { x: q.x, x0: q.x, t }
      try { cv.setPointerCapture(e.pointerId) } catch { /* niente */ }
    }
    function muovi(e) {
      const q = locale(e), t = performance.now()
      if (e.pointerType === 'mouse' && !e.buttons) { dito = q; return }
      if (!trascino) return
      const dx = q.x - trascino.x
      rot -= dx * 0.009
      vel = -(dx * 0.009) / Math.max(8, t - trascino.t)
      trascino = { ...trascino, x: q.x, t }
      dito = q
      if (fermo) disegna(t)
    }
    function su(e) {
      const q = locale(e), t = performance.now()
      const fuTocco = trascino && Math.abs(q.x - trascino.x0) < 8
      trascino = null
      dito = null
      vel = Math.max(-0.006, Math.min(0.006, vel))
      if (!fuTocco) return
      let vicino = null, dmin = 30
      for (const n of vivi) {
        if (n.via || n.dentro) continue
        const p = posNodo(n, t), d = Math.hypot(p.x - q.x, p.y - q.y)
        if (d < dmin) { dmin = d; vicino = n }
      }
      if (vicino) {
        scelto = vicino.id
        sceltoT = t
        motore.current.onTocca?.(vicino)
        if (fermo) disegna(t)
      }
    }
    function annulla() { trascino = null; dito = null }
    cv.addEventListener('pointerdown', giu)
    cv.addEventListener('pointermove', muovi)
    cv.addEventListener('pointerup', su)
    cv.addEventListener('pointercancel', annulla)
    cv.addEventListener('pointerleave', () => { if (!trascino) dito = null })

    misura()
    const oss = new ResizeObserver(() => { misura(); if (fermo) disegna(performance.now()) })
    oss.observe(cv)

    // Si anima solo quando si vede: app in primo piano e rete sullo schermo (batteria).
    let attivo = !fermo
    let giro = 0
    let inVista = true
    function ciclo(t) { if (!attivo) return; disegna(t); giro = requestAnimationFrame(ciclo) }
    function visibilita() {
      if (fermo) return
      const ora = !document.hidden && inVista
      if (ora === attivo) return
      attivo = ora
      if (attivo) { tPrima = performance.now(); giro = requestAnimationFrame(ciclo) } else cancelAnimationFrame(giro)
    }
    document.addEventListener('visibilitychange', visibilita)
    const vista = new IntersectionObserver(([e]) => { inVista = e.isIntersecting; visibilita() })
    vista.observe(cv)
    if (fermo) disegna(performance.now())
    else giro = requestAnimationFrame(ciclo)

    motore.current = {
      onTocca: null,
      aggiorna(lista) {
        const ids = new Set(lista.map((n) => n.id))
        for (const n of vivi) if (!ids.has(n.id) && !n.dentro) n.via = true
        for (const nuovo of lista) {
          const n = vivi.find((x) => x.id === nuovo.id)
          if (n) { Object.assign(n, nuovo); n.via = false; continue }
          vivi.push({ ...nuovo, ang: Math.random() * Math.PI * 2, fase: Math.random() * 6, alfa: 0, seg: Math.random(), vel: 0.0005 + Math.random() * 0.0003 })
        }
        if (fermo) disegna(performance.now())
      },
      assorbi(id) {
        const n = vivi.find((x) => x.id === id)
        if (!n || n.dentro) return
        const t = performance.now(), p = posNodo(n, t)
        n.dentro = { t, x: p.x, y: p.y }
        if (fermo) { n.morto = true; lampoT = t; disegna(t) }
      },
    }

    return () => {
      attivo = false
      cancelAnimationFrame(giro)
      oss.disconnect()
      vista.disconnect()
      document.removeEventListener('visibilitychange', visibilita)
      cv.removeEventListener('pointerdown', giu)
      cv.removeEventListener('pointermove', muovi)
      cv.removeEventListener('pointerup', su)
      cv.removeEventListener('pointercancel', annulla)
    }
  }, [])

  useEffect(() => { motore.current.onTocca = onTocca }, [onTocca])
  useEffect(() => { motore.current.aggiorna(nodi) }, [nodi])
  useImperativeHandle(ref, () => ({ assorbi: (id) => motore.current?.assorbi(id) }), [])

  return <canvas ref={tela} className="rete-tela" aria-hidden="true" />
}
