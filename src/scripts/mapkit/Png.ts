import zlib from "zlib";

// A small PNG reader and writer for the map kit (docs/MapMaking.md), with no
// dependencies: the repo's `canvas` package needs a native build that
// `npm ci --ignore-scripts` never runs.
//
// The reader handles what paint programs write: 8-bit greyscale, RGB,
// palette and RGBA, non-interlaced. The writer always emits RGBA8.

export interface Image {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, rows top to bottom. */
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(image: Image): Buffer {
  const { width, height, rgba } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Channels per pixel for a PNG colour type, or 0 when unsupported. */
function channelsFor(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // greyscale
    case 2:
      return 3; // RGB
    case 3:
      return 1; // palette index
    case 4:
      return 2; // greyscale + alpha
    case 6:
      return 4; // RGBA
    default:
      return 0;
  }
}

/**
 * Decodes a PNG. Throws an Error whose message is meant for the person who
 * drew the picture when the file is not something the kit can read.
 */
export function decodePng(file: Uint8Array): Image {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) {
    throw new Error(
      "This is not a PNG file. In Paint use File > Save as > PNG picture.",
    );
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = new Uint8Array(data);
    } else if (type === "tRNS") {
      paletteAlpha = new Uint8Array(data);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  const channels = channelsFor(colorType);
  if (width === 0 || height === 0 || channels === 0) {
    throw new Error("This PNG file is damaged or has no image in it.");
  }
  if (interlace !== 0) {
    throw new Error(
      "This PNG is interlaced, which the kit cannot read. Save it again from Paint as a PNG picture.",
    );
  }
  const packed = colorType === 3 && bitDepth < 8;
  if (bitDepth !== 8 && !packed) {
    throw new Error(
      `This PNG uses ${bitDepth} bits per channel; the kit reads 8. Save it again from Paint as a PNG picture.`,
    );
  }
  if (colorType === 3 && palette === null) {
    throw new Error("This PNG file is damaged (it has no colour table).");
  }

  // Bytes per complete pixel, for the filters (at least 1), and bytes per row.
  const bpp = packed ? 1 : channels;
  const rowBytes = packed
    ? Math.ceil((width * bitDepth) / 8)
    : width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < (rowBytes + 1) * height) {
    throw new Error("This PNG file is damaged (its image data is cut short).");
  }

  // Undo the per-row filters in place.
  const pixels = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const up = dst - rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? pixels[dst + i - bpp] : 0;
      const b = y > 0 ? pixels[up + i] : 0;
      const c = y > 0 && i >= bpp ? pixels[up + i - bpp] : 0;
      let v = raw[src + i];
      switch (filter) {
        case 0:
          break;
        case 1:
          v += a;
          break;
        case 2:
          v += b;
          break;
        case 3:
          v += (a + b) >> 1;
          break;
        case 4:
          v += paeth(a, b, c);
          break;
        default:
          throw new Error("This PNG file is damaged (unknown row filter).");
      }
      pixels[dst + i] = v & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (colorType === 3) {
        let index: number;
        if (packed) {
          const bit = x * bitDepth;
          const byte = pixels[y * rowBytes + (bit >> 3)];
          const shift = 8 - bitDepth - (bit & 7);
          index = (byte >> shift) & ((1 << bitDepth) - 1);
        } else {
          index = pixels[y * rowBytes + x];
        }
        r = palette![index * 3] ?? 0;
        g = palette![index * 3 + 1] ?? 0;
        b = palette![index * 3 + 2] ?? 0;
        if (paletteAlpha !== null && index < paletteAlpha.length) {
          a = paletteAlpha[index];
        }
      } else {
        const p = y * rowBytes + x * channels;
        if (colorType === 0 || colorType === 4) {
          r = g = b = pixels[p];
          if (colorType === 4) a = pixels[p + 1];
        } else {
          r = pixels[p];
          g = pixels[p + 1];
          b = pixels[p + 2];
          if (colorType === 6) a = pixels[p + 3];
        }
      }
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
  return { width, height, rgba };
}
