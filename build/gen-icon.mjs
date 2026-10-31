// Generates build/icon.png (256x256 RGBA) without any image dependency.
// Mark: violet rounded square with four rounded bars — a voice level meter.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const SIZE = 256
const px = new Uint8Array(SIZE * SIZE * 4)

const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

const shapes = [
  { test: roundRect(8, 8, 248, 248, 56), color: [184, 146, 255, 255] }, // accent plate
  { test: roundRect(70, 118, 84, 178, 7), color: [20, 16, 30, 255] },
  { test: roundRect(96, 88, 110, 208, 7), color: [20, 16, 30, 255] },
  { test: roundRect(122, 56, 136, 240, 7), color: [20, 16, 30, 255] },
  { test: roundRect(148, 96, 162, 200, 7), color: [20, 16, 30, 255] },
  { test: roundRect(174, 128, 188, 168, 7), color: [20, 16, 30, 255] }
]

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    for (const shape of shapes) {
      if (!shape.test(x + 0.5, y + 0.5)) continue
      px[i] = shape.color[0]
      px[i + 1] = shape.color[1]
      px[i + 2] = shape.color[2]
      px[i + 3] = shape.color[3]
    }
  }
}

const table = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1)
  raw[rowStart] = 0
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, rowStart + 1)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`build/icon.png ${png.length} bytes`)
