// Disegna le icone dell'app (tre cerchi C, G, P che si sovrappongono) e le salva in public/.
// Uso: npm run icone
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const SFONDO = [28, 25, 23]
const CERCHI = [
  { x: 0.40, y: 0.40, c: [37, 99, 235] },  // C Ceramex
  { x: 0.60, y: 0.40, c: [22, 163, 74] },  // G G&C
  { x: 0.50, y: 0.575, c: [234, 88, 12] }, // P Privato
]

function disegna(lato, scala) {
  const r = 0.2 * scala
  const px = Buffer.alloc(lato * lato * 4)
  const N = 4
  for (let y = 0; y < lato; y++) {
    for (let x = 0; x < lato; x++) {
      let acc = [0, 0, 0]
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const u = (x + (sx + 0.5) / N) / lato
          const v = (y + (sy + 0.5) / N) / lato
          let col = [...SFONDO]
          for (const k of CERCHI) {
            const cx = 0.5 + (k.x - 0.5) * scala
            const cy = 0.5 + (k.y - 0.5) * scala
            if ((u - cx) ** 2 + (v - cy) ** 2 <= r * r) {
              col = col.map((c, i) => c * 0.3 + k.c[i] * 0.7)
            }
          }
          acc = acc.map((a, i) => a + col[i])
        }
      }
      const o = (y * lato + x) * 4
      px[o] = Math.round(acc[0] / (N * N))
      px[o + 1] = Math.round(acc[1] / (N * N))
      px[o + 2] = Math.round(acc[2] / (N * N))
      px[o + 3] = 255
    }
  }
  return png(lato, px)
}

const TAB = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc(buf) {
  let c = 0xffffffff
  for (const b of buf) c = TAB[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function blocco(tipo, dati) {
  const lun = Buffer.alloc(4); lun.writeUInt32BE(dati.length)
  const td = Buffer.concat([Buffer.from(tipo), dati])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([lun, td, c])
}
function png(lato, px) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(lato, 0); ihdr.writeUInt32BE(lato, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const righe = Buffer.alloc(lato * (lato * 4 + 1))
  for (let y = 0; y < lato; y++) px.copy(righe, y * (lato * 4 + 1) + 1, y * lato * 4, (y + 1) * lato * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocco('IHDR', ihdr), blocco('IDAT', deflateSync(righe)), blocco('IEND', Buffer.alloc(0)),
  ])
}

const dir = new URL('../public/', import.meta.url)
writeFileSync(new URL('icon-192.png', dir), disegna(192, 1))
writeFileSync(new URL('icon-512.png', dir), disegna(512, 1))
writeFileSync(new URL('icon-maskable-512.png', dir), disegna(512, 0.78))
writeFileSync(new URL('apple-touch-icon.png', dir), disegna(180, 0.9))
console.log('Icone create in public/')
