/**
 * PenDrops app icon generator — `npm run icons`.
 *
 * The icon is drawn from a single declarative shape list that is rendered twice:
 * once as SVG and once as a software-rasterised PNG. That keeps the scalable and
 * the raster icon in sync by construction instead of by hand.
 *
 * Guarantees the script must keep:
 * - deterministic: no network, no randomness, no timestamps, no machine paths.
 *   Running `npm run icons` twice produces byte-identical files, so the icons
 *   are reviewable in a diff instead of being an opaque binary blob.
 * - dependency free: the rasteriser and the PNG encoder are implemented here on
 *   top of `node:zlib`, so CI and a fresh clone can regenerate the icons.
 * - maskable: the background fills the whole square and every meaningful shape
 *   stays inside the central 80% safe zone (a circle of radius 204.8 around the
 *   centre of the 512x512 artboard), so no launcher mask can cut the calendar.
 * - legible at 48px: no text glyphs, only large flat shapes.
 *
 * Determinism caveat: the PNG byte stream depends on the zlib build shipped
 * with the running Node version. Same Node major on the same machine reproduces
 * the exact same bytes; a different zlib may pick different deflate blocks
 * without changing the pixels.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* -------------------------------------------------------------------------- */
/* Artboard                                                                    */
/* -------------------------------------------------------------------------- */

/** The artboard is authored at 512x512 and scaled to every raster size. */
const ARTBOARD = 512;

/**
 * Maskable safe zone: a circle of diameter 80% of the icon centred on the
 * artboard. Every shape below is checked against it by `assertSafeZone`.
 */
const SAFE_RADIUS = ARTBOARD * 0.4;

/** Palette, taken from styles.css / the app manifest so the icon cannot drift. */
const COLORS = Object.freeze({
  background: '#0f172a', // --bg of the installed app / manifest theme_color
  card: '#f8fafc',
  header: '#a78bfa', // --violet
  headerSoft: '#e9d5ff',
  grid: '#cbd5e1',
  accent: '#a78bfa',
  accentAlt: '#f0abfc', // --pink
});

/**
 * The icon: a light calendar sheet with a violet header on the dark app
 * background, two binder rings and a 3x2 grid of lesson pills.
 *
 * Every coordinate is an integer so the SVG and the raster agree exactly.
 */
function buildShapes() {
  // Calendar sheet, centred: 264x248 with 48px corner radius.
  const card = { x: 124, y: 136, w: 264, h: 248, r: 48 };

  // Header band: rounded on top, squared off at the bottom.
  const headerH = 76;

  // Binder rings poking out above the sheet.
  const ringW = 32;
  const ringH = 64;
  const ringY = 108;
  const rings = [180, 300].map((x) => ({ x, y: ringY, w: ringW, h: ringH, r: 16 }));

  // Lesson grid: 3 columns x 2 rows, centred inside the sheet body.
  const colW = 52;
  const colGap = 20;
  const rowH = 34;
  const rowGap = 24;
  const gridW = colW * 3 + colGap * 2;
  const gridH = rowH * 2 + rowGap;
  const bodyTop = card.y + headerH;
  const bodyH = card.h - headerH;
  const gridStartX = card.x + Math.round((card.w - gridW) / 2);
  const gridStartY = bodyTop + Math.round((bodyH - gridH) / 2);

  const pillColor = (row, col) => {
    if (row === 0 && col === 0) return COLORS.accent;
    if (row === 1 && col === 2) return COLORS.accentAlt;
    return COLORS.grid;
  };

  const pills = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      pills.push({
        type: 'rect',
        x: gridStartX + col * (colW + colGap),
        y: gridStartY + row * (rowH + rowGap),
        w: colW,
        h: rowH,
        r: 12,
        color: pillColor(row, col),
      });
    }
  }

  return [
    // Full-bleed background: required for a maskable icon, the launcher mask
    // must never reveal transparency.
    { type: 'rect', x: 0, y: 0, w: ARTBOARD, h: ARTBOARD, color: COLORS.background },
    { type: 'rect', x: card.x, y: card.y, w: card.w, h: card.h, r: card.r, color: COLORS.card },
    {
      type: 'rect',
      x: card.x,
      y: card.y,
      w: card.w,
      h: headerH,
      r: card.r,
      color: COLORS.header,
    },
    // Squares off the bottom corners of the header band.
    {
      type: 'rect',
      x: card.x,
      y: card.y + headerH - card.r,
      w: card.w,
      h: card.r,
      color: COLORS.header,
    },
    // Sheet body below the header, so the two bands never blend.
    {
      type: 'rect',
      x: card.x,
      y: card.y + headerH,
      w: card.w,
      h: card.h - headerH,
      color: COLORS.card,
    },
    ...rings.map((ring) => ({ type: 'rect', ...ring, color: COLORS.headerSoft })),
    ...pills,
  ];
}

/* -------------------------------------------------------------------------- */
/* SVG renderer                                                                */
/* -------------------------------------------------------------------------- */

function shapesToSvg(shapes) {
  const body = shapes
    .map((shape) => {
      const r = shape.r ? ` rx="${shape.r}"` : '';
      return `  <rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}"${r} fill="${shape.color}" />`;
    })
    .join('\n');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="PenDrops">',
    body,
    '</svg>',
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Software rasteriser                                                         */
/* -------------------------------------------------------------------------- */

/** Hex colour to a non-premultiplied RGBA tuple. */
function parseColor(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    255,
  ];
}

/**
 * Coverage of one pixel for a rounded rectangle, sampled on a fixed
 * `SAMPLES x SAMPLES` grid. Fixed sample count and a fixed order make the
 * result reproducible bit for bit.
 */
const SAMPLES = 4;

function insideRoundedRect(sx, sy, shape) {
  const x = sx - shape.x;
  const y = sy - shape.y;
  if (x < 0 || y < 0 || x > shape.w || y > shape.h) return false;
  const r = Math.min(shape.r ?? 0, shape.w / 2, shape.h / 2);
  if (r <= 0) return true;
  // Only the four corner squares need the distance test.
  const cx = x < r ? r : x > shape.w - r ? shape.w - r : x;
  const cy = y < r ? r : y > shape.h - r ? shape.h - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function rasterize(shapes, size) {
  const scale = size / ARTBOARD;
  const buf = new Uint8Array(size * size * 4);
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;

  for (const shape of shapes) {
    const [sr, sg, sb, sa] = parseColor(shape.color);
    const alpha = sa / 255;
    const x0 = Math.max(0, Math.floor((shape.x - (shape.r ?? 0)) * scale));
    const y0 = Math.max(0, Math.floor((shape.y - (shape.r ?? 0)) * scale));
    const x1 = Math.min(size, Math.ceil((shape.x + shape.w + (shape.r ?? 0)) * scale));
    const y1 = Math.min(size, Math.ceil((shape.y + shape.h + (shape.r ?? 0)) * scale));
    const total = SAMPLES * SAMPLES;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        let hits = 0;
        for (let sy = 0; sy < SAMPLES; sy++) {
          // Sample centres in artboard coordinates: (pixel + offset) / scale.
          const y = (py + (sy + 0.5) / SAMPLES) / scale;
          for (let sx = 0; sx < SAMPLES; sx++) {
            const x = (px + (sx + 0.5) / SAMPLES) / scale;
            if (insideRoundedRect(x, y, shape)) hits++;
          }
        }
        if (hits === 0) continue;
        const coverage = (hits / total) * alpha;
        const offset = (py * size + px) * 4;
        buf[offset] = Math.round(sr * coverage + buf[offset] * (1 - coverage));
        buf[offset + 1] = Math.round(sg * coverage + buf[offset + 1] * (1 - coverage));
        buf[offset + 2] = Math.round(sb * coverage + buf[offset + 2] * (1 - coverage));
        buf[offset + 3] = Math.round(255 * coverage + buf[offset + 3] * (1 - coverage));
      }
    }
  }

  return buf;
}

/* -------------------------------------------------------------------------- */
/* PNG encoder (RGBA8, no interlace)                                           */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline keeps the encoder trivial and the
  // output a pure function of the pixels.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Invariants                                                                  */
/* -------------------------------------------------------------------------- */

/** Fails the build if any meaningful shape can be cut by a launcher mask. */
function assertSafeZone(shapes) {
  // The full-bleed background is exempt: it is meant to reach every edge.
  const content = shapes.filter((shape) => shape.w !== ARTBOARD || shape.h !== ARTBOARD);
  const offenders = [];
  for (const shape of content) {
    const r = Math.min(shape.r ?? 0, shape.w / 2, shape.h / 2);
    const corners = [
      [shape.x + r, shape.y + r],
      [shape.x + shape.w - r, shape.y + r],
      [shape.x + r, shape.y + shape.h - r],
      [shape.x + shape.w - r, shape.y + shape.h - r],
    ];
    for (const [x, y] of corners) {
      const d = Math.hypot(x - ARTBOARD / 2, y - ARTBOARD / 2);
      if (d > SAFE_RADIUS) {
        offenders.push(`${shape.type} at (${x}, ${y}) is ${d.toFixed(1)}px from the centre`);
      }
    }
  }
  if (offenders.length) {
    throw new Error(`Icon content leaves the maskable safe zone:\n  - ${offenders.join('\n  - ')}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

const OUTPUTS = [
  { file: 'icon.svg', render: (shapes) => Buffer.from(shapesToSvg(shapes), 'utf-8') },
  { file: 'icon-192.png', render: (shapes) => encodePng(rasterize(shapes, 192), 192) },
  { file: 'icon-512.png', render: (shapes) => encodePng(rasterize(shapes, 512), 512) },
];

const outDir = resolve(ROOT, 'public', 'icons');
const shapes = buildShapes();
assertSafeZone(shapes);

mkdirSync(outDir, { recursive: true });
for (const output of OUTPUTS) {
  const bytes = output.render(shapes);
  writeFileSync(resolve(outDir, output.file), bytes);
  console.log(`[icons] public/icons/${output.file} (${bytes.length} bytes)`);
}
