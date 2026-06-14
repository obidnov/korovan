#!/usr/bin/env node
/**
 * Generates 5 CC0-attributed placeholder assets into public/assets/.
 * Run once: node scripts/gen-placeholders.mjs
 * Sources are noted in public/assets/CREDITS.md.
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import zlib from 'zlib'

const OUT_DIR = 'public/assets'
mkdirSync(OUT_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// GLB helpers
// ---------------------------------------------------------------------------

function pad4(n) {
  return Math.ceil(n / 4) * 4
}

/**
 * Pack a simple triangle-list mesh into a binary GLB (glTF 2.0).
 * @param {string} name        Scene / mesh name (informational only)
 * @param {number[]} positions Flat XYZ float values (3 per vertex)
 * @param {number[]} indices   Flat uint16 indices (3 per triangle)
 */
function createGLB(name, positions, indices) {
  const vtxData = new Float32Array(positions)
  const idxData = new Uint16Array(indices)
  const vtxBuf = Buffer.from(vtxData.buffer)
  const idxBuf = Buffer.from(idxData.buffer)

  const vtxPadded = pad4(vtxBuf.length)
  const idxPadded = pad4(idxBuf.length)
  const binLen = vtxPadded + idxPadded

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i])
    minY = Math.min(minY, positions[i + 1])
    minZ = Math.min(minZ, positions[i + 2])
    maxX = Math.max(maxX, positions[i])
    maxY = Math.max(maxY, positions[i + 1])
    maxZ = Math.max(maxZ, positions[i + 2])
  }

  const gltf = {
    asset: { version: '2.0', generator: 'korovan-placeholder' },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vtxBuf.length },
      { buffer: 0, byteOffset: vtxPadded, byteLength: idxBuf.length },
    ],
    buffers: [{ byteLength: binLen }],
  }

  const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8')
  const jsonPadded = pad4(jsonBytes.length)
  const jsonChunk = Buffer.alloc(jsonPadded, 0x20) // pad with ASCII spaces
  jsonBytes.copy(jsonChunk)

  const totalLen = 12 + 8 + jsonPadded + 8 + binLen
  const out = Buffer.alloc(totalLen, 0)
  let off = 0

  // Header
  out.write('glTF', off, 'ascii'); off += 4
  out.writeUInt32LE(2, off); off += 4
  out.writeUInt32LE(totalLen, off); off += 4

  // JSON chunk
  out.writeUInt32LE(jsonPadded, off); off += 4
  out.writeUInt32LE(0x4e4f534a, off); off += 4 // 'JSON'
  jsonChunk.copy(out, off); off += jsonPadded

  // BIN chunk
  out.writeUInt32LE(binLen, off); off += 4
  out.writeUInt32LE(0x004e4942, off); off += 4 // 'BIN\0'
  vtxBuf.copy(out, off); off += vtxPadded
  idxBuf.copy(out, off)

  return out
}

/** Build box positions + indices for a box centred at x=0, z=0, bottom at y=0. */
function box(w, h, d) {
  const hw = w / 2
  const hd = d / 2
  const pos = [
    -hw, 0, -hd,   hw, 0, -hd,   hw, 0,  hd,  -hw, 0,  hd,
    -hw, h, -hd,   hw, h, -hd,   hw, h,  hd,  -hw, h,  hd,
  ]
  const idx = [
    // bottom (CCW viewed from -y)
    0, 2, 1,  0, 3, 2,
    // top (CCW viewed from +y)
    4, 5, 6,  4, 6, 7,
    // front (-z face, CCW from -z)
    0, 1, 5,  0, 5, 4,
    // back (+z face, CCW from +z)
    2, 7, 6,  2, 3, 7,
    // left (-x, CCW from -x)
    0, 4, 7,  0, 7, 3,
    // right (+x, CCW from +x)
    1, 2, 6,  1, 6, 5,
  ]
  return { pos, idx }
}

/** Merge two separate box meshes into one combined mesh. */
function merge(a, b, yOffset = 0) {
  const vtxCountA = a.pos.length / 3
  const shiftedBPos = b.pos.map((v, i) => (i % 3 === 1 ? v + yOffset : v))
  const shiftedBIdx = b.idx.map((i) => i + vtxCountA)
  return {
    pos: [...a.pos, ...shiftedBPos],
    idx: [...a.idx, ...shiftedBIdx],
  }
}

// ---------------------------------------------------------------------------
// Model definitions (stylised placeholder geometry)
// ---------------------------------------------------------------------------

const MODELS = {
  // Tall thin trunk (0.2×0.8) capped by wide foliage blob (0.8×1.2)
  tree: merge(box(0.2, 0.8, 0.2), box(0.8, 1.2, 0.8), 0.7),

  // Short stout creature (house-elf guard)
  'house-elf': merge(box(0.35, 0.5, 0.25), box(0.3, 0.3, 0.3), 0.5),

  // Normal-sized player character
  player: merge(box(0.5, 1.1, 0.3), box(0.4, 0.4, 0.4), 1.1),

  // Slightly bulkier soldier
  soldier: merge(box(0.6, 1.2, 0.35), box(0.45, 0.45, 0.45), 1.2),
}

for (const [name, { pos, idx }] of Object.entries(MODELS)) {
  const glb = createGLB(name, pos, idx)
  const path = join(OUT_DIR, `${name}.glb`)
  writeFileSync(path, glb)
  console.log(`✓  ${path}  (${glb.length} B)`)
}

// ---------------------------------------------------------------------------
// tree-billboard.png  — minimal 64×64 RGBA PNG of a stylised tree silhouette
// ---------------------------------------------------------------------------

function crc32Table() {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
}

const CRC_TABLE = crc32Table()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.allocUnsafe(4)
  lenBuf.writeUInt32BE(data.length)
  const crcVal = Buffer.allocUnsafe(4)
  crcVal.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([lenBuf, typeBuf, data, crcVal])
}

function buildPNG(w, h, getPixel) {
  // Raw scanlines: 1 filter byte (0=None) + w * 4 RGBA bytes each row
  const rows = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4)
    row[0] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = getPixel(x, y)
      row[1 + x * 4] = r
      row[2 + x * 4] = g
      row[3 + x * 4] = b
      row[4 + x * 4] = a
    }
    rows.push(row)
  }

  const compressed = zlib.deflateSync(Buffer.concat(rows), { level: 9 })

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // RGBA
  // bytes 10-12 are already 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG sig
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const S = 64
const treePng = buildPNG(S, S, (x, y) => {
  const cx = S / 2
  const cy = S / 2
  const dx = x - cx
  const dy = y - cy
  // Foliage: diamond centred at (cx, cy-10)
  const isFoliage = Math.abs(dx / 20) + Math.abs((dy + 10) / 24) <= 1
  // Trunk: thin rect below foliage centre
  const isTrunk = Math.abs(dx) <= 3 && dy > 8 && dy <= 22
  if (isFoliage) return [34, 139, 34, 255]
  if (isTrunk) return [101, 67, 33, 255]
  return [0, 0, 0, 0]
})

const pngPath = join(OUT_DIR, 'tree-billboard.png')
writeFileSync(pngPath, treePng)
console.log(`✓  ${pngPath}  (${treePng.length} B)`)
