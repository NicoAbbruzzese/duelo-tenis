// Genera los iconos PNG de la app (sin dependencias): node tools/make-icons.js
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'img');
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3; // supermuestreo para bordes suaves
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const p = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += p[0]; g += p[1]; b += p[2];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4, n = SS * SS;
      raw[o] = r / n; raw[o + 1] = g / n; raw[o + 2] = b / n; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// Pelota amarilla sobre una cancha azul con una línea blanca.
function pixel(u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  let c = [12, 30, 62];
  const t = v;
  c = [10 + 20 * t, 26 + 60 * t, 51 + 90 * t];
  if (Math.abs(v - 0.8) < 0.022) c = [255, 255, 255];
  const d = Math.hypot(dx, dy - 0.02);
  const sh = Math.hypot(dx - 0.02, dy - 0.3) ;
  if (Math.hypot((u - 0.52) / 1.0, (v - 0.84) / 0.35) < 0.2) c = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55];
  if (d < 0.3) {
    const k = 1 - 0.28 * Math.max(0, (dx + dy) / 0.42);
    c = [215 * k + 20, 245 * k + 8, 49 * k];
    // costuras
    const s1 = Math.hypot(dx + 0.36, dy - 0.02), s2 = Math.hypot(dx - 0.36, dy - 0.02);
    if (Math.abs(s1 - 0.3) < 0.017 || Math.abs(s2 - 0.3) < 0.017) c = [250, 252, 240];
  }
  return c;
}
for (const s of [192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s, pixel));
console.log('iconos listos en', out);
