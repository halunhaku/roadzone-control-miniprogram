/**
 * 最小 PNG 解码：支持 canvas 导出的 8-bit RGB / RGBA，非交错。
 */

const { inflateZlib } = require('./zlib');

function u32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(data, width, height, bpp) {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let src = 0;
  let dst = 0;
  for (let y = 0; y < height; y++) {
    const type = data[src++];
    for (let x = 0; x < stride; x++) {
      const raw = data[src++];
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst + x - stride] : 0;
      const c = y > 0 && x >= bpp ? out[dst + x - stride - bpp] : 0;
      let val;
      if (type === 0) val = raw;
      else if (type === 1) val = raw + a;
      else if (type === 2) val = raw + b;
      else if (type === 3) val = raw + ((a + b) >> 1);
      else if (type === 4) val = raw + paeth(a, b, c);
      else throw new Error(`png: 不支持的滤镜 ${type}`);
      out[dst + x] = val & 0xff;
    }
    dst += stride;
  }
  return out;
}

function toRgb(pixels, width, height, colorType) {
  const count = width * height;
  const rgb = new Uint8Array(count * 3);
  if (colorType === 2) {
    rgb.set(pixels);
    return rgb;
  }
  if (colorType === 6) {
    for (let i = 0, j = 0; i < count; i++, j += 4) {
      const a = pixels[j + 3] / 255;
      rgb[i * 3] = Math.round(pixels[j] * a + 255 * (1 - a));
      rgb[i * 3 + 1] = Math.round(pixels[j + 1] * a + 255 * (1 - a));
      rgb[i * 3 + 2] = Math.round(pixels[j + 2] * a + 255 * (1 - a));
    }
    return rgb;
  }
  throw new Error(`png: 不支持的颜色类型 ${colorType}`);
}

function decodePng(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error('png: 不是 PNG');
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idats = [];
  while (off + 12 <= bytes.length) {
    const len = u32(bytes, off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = u32(data, 0);
      height = u32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height) throw new Error('png: 缺少 IHDR');
  if (bitDepth !== 8) throw new Error('png: 仅支持 8-bit');
  if (interlace) throw new Error('png: 不支持交错');
  if (colorType !== 2 && colorType !== 6) throw new Error('png: 仅支持 RGB/RGBA');
  let idatLen = 0;
  idats.forEach(c => { idatLen += c.length; });
  const idat = new Uint8Array(idatLen);
  let p = 0;
  idats.forEach(c => { idat.set(c, p); p += c.length; });
  const bpp = colorType === 6 ? 4 : 3;
  const inflated = inflateZlib(idat);
  const expected = (width * bpp + 1) * height;
  if (inflated.length < expected) throw new Error('png: 解压数据不足');
  const pixels = unfilter(inflated, width, height, bpp);
  return { width, height, rgb: toRgb(pixels, width, height, colorType) };
}

module.exports = { decodePng };
