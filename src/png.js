const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FILTER_SUB = 1;

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body), body.length + 4);
  return out;
}

function bgraToPng({ pixels, width, height, stride = width * 4 }) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    let from = y * stride;
    let to = y * row;
    raw[to++] = FILTER_SUB;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = 0; x < width; x++, from += 4) {
      const nextB = pixels[from];
      const nextG = pixels[from + 1];
      const nextR = pixels[from + 2];
      raw[to++] = nextR - r;
      raw[to++] = nextG - g;
      raw[to++] = nextB - b;
      r = nextR;
      g = nextG;
      b = nextB;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { bgraToPng };
