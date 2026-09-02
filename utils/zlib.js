/**
 * 最小 zlib inflate / deflate（无第三方依赖）。
 * inflate 供 PNG IDAT 解码；deflate 供 PDF /FlateDecode 压缩 RGB。
 */

function u16le(b, i) {
  return b[i] | (b[i + 1] << 8);
}

function adler32(data) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/* ── inflate（RFC 1951，覆盖 PNG / canvas 导出常见块） ── */

function buildHuffman(lengths) {
  let max = 0;
  for (let i = 0; i < lengths.length; i++) if (lengths[i] > max) max = lengths[i];
  const blCount = new Uint16Array(max + 1);
  lengths.forEach(len => { if (len) blCount[len]++; });
  const nextCode = new Uint16Array(max + 1);
  let code = 0;
  for (let bits = 1; bits <= max; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  const root = {};
  for (let n = 0; n < lengths.length; n++) {
    const len = lengths[n];
    if (!len) continue;
    let c = nextCode[len]++;
    let node = root;
    for (let i = 0; i < len; i++) {
      const bit = (c >> (len - 1 - i)) & 1;
      if (i === len - 1) node[bit] = n;
      else {
        node[bit] = node[bit] || {};
        node = node[bit];
      }
    }
  }
  return root;
}

function fixedLit() {
  const lengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return buildHuffman(lengths);
}

function fixedDist() {
  const lengths = new Uint8Array(32);
  lengths.fill(5);
  return buildHuffman(lengths);
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function inflateRaw(src) {
  let bitPos = 0;
  const out = [];
  const bit = () => {
    const v = (src[bitPos >> 3] >> (bitPos & 7)) & 1;
    bitPos++;
    return v;
  };
  const bits = n => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= bit() << i;
    return v;
  };
  const decode = tree => {
    let node = tree;
    while (typeof node === 'object') {
      if (!node) throw new Error('inflate: 无效 Huffman 码');
      node = node[bit()];
    }
    if (typeof node !== 'number') throw new Error('inflate: 无效 Huffman 码');
    return node;
  };

  const FIXED_LIT = fixedLit();
  const FIXED_DIST = fixedDist();

  let last = 0;
  while (!last) {
    last = bit();
    const type = bits(2);
    if (type === 3) throw new Error('inflate: 无效块类型');
    if (type === 0) {
      bitPos = (bitPos + 7) & ~7;
      const i = bitPos >> 3;
      const len = u16le(src, i);
      const nlen = u16le(src, i + 2);
      if ((len ^ 0xffff) !== nlen) throw new Error('inflate: stored 块长度校验失败');
      for (let k = 0; k < len; k++) out.push(src[i + 4 + k]);
      bitPos = (i + 4 + len) << 3;
      continue;
    }
    let lit;
    let dist;
    if (type === 1) {
      lit = FIXED_LIT;
      dist = FIXED_DIST;
    } else {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const clens = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) clens[CL_ORDER[i]] = bits(3);
      const clTree = buildHuffman(Array.from(clens));
      const all = [];
      while (all.length < hlit + hdist) {
        const sym = decode(clTree);
        if (sym < 16) all.push(sym);
        else if (sym === 16) {
          const prev = all.length ? all[all.length - 1] : 0;
          const rep = bits(2) + 3;
          for (let i = 0; i < rep; i++) all.push(prev);
        } else if (sym === 17) {
          const rep = bits(3) + 3;
          for (let i = 0; i < rep; i++) all.push(0);
        } else {
          const rep = bits(7) + 11;
          for (let i = 0; i < rep; i++) all.push(0);
        }
      }
      lit = buildHuffman(all.slice(0, hlit));
      dist = buildHuffman(all.slice(hlit));
    }
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        out.push(sym);
      } else if (sym === 256) {
        break;
      } else {
        const li = sym - 257;
        const length = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        const distance = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        const start = out.length - distance;
        for (let i = 0; i < length; i++) out.push(out[start + i]);
      }
    }
  }
  return Uint8Array.from(out);
}

function inflateZlib(src) {
  if (src.length < 6) throw new Error('inflate: zlib 数据太短');
  const cmf = src[0];
  const flg = src[1];
  if ((cmf & 0x0f) !== 8) throw new Error('inflate: 仅支持 deflate');
  if (((cmf << 8) + flg) % 31 !== 0) throw new Error('inflate: zlib 头校验失败');
  if (flg & 0x20) throw new Error('inflate: 不支持字典');
  return inflateRaw(src.subarray(2, src.length - 4));
}

/* ── deflate：LZ77 + 固定 Huffman + zlib 头 ── */

function bitWriter() {
  const bytes = [];
  let acc = 0;
  let n = 0;
  const writeBits = (value, width) => {
    acc |= (value << n);
    n += width;
    while (n >= 8) {
      bytes.push(acc & 0xff);
      acc >>= 8;
      n -= 8;
    }
  };
  const align = () => {
    if (n) {
      bytes.push(acc & 0xff);
      acc = 0;
      n = 0;
    }
  };
  return {
    writeBits,
    align,
    result() {
      align();
      return Uint8Array.from(bytes);
    },
  };
}

function reverseBits(code, len) {
  let r = 0;
  for (let i = 0; i < len; i++) r = (r << 1) | ((code >> i) & 1);
  return r;
}

function litCode(sym) {
  if (sym <= 143) return { code: reverseBits(0x30 + sym, 8), len: 8 };
  if (sym <= 255) return { code: reverseBits(0x190 + (sym - 144), 9), len: 9 };
  if (sym <= 279) return { code: reverseBits(sym - 256, 7), len: 7 };
  return { code: reverseBits(0xc0 + (sym - 280), 8), len: 8 };
}

function distCode(sym) {
  return { code: reverseBits(sym, 5), len: 5 };
}

function encodeLength(length) {
  for (let i = LEN_BASE.length - 1; i >= 0; i--) {
    if (length >= LEN_BASE[i]) {
      return { sym: 257 + i, extra: length - LEN_BASE[i], extraBits: LEN_EXTRA[i] };
    }
  }
  return { sym: 257, extra: 0, extraBits: 0 };
}

function encodeDist(distance) {
  for (let i = DIST_BASE.length - 1; i >= 0; i--) {
    if (distance >= DIST_BASE[i]) {
      return { sym: i, extra: distance - DIST_BASE[i], extraBits: DIST_EXTRA[i] };
    }
  }
  return { sym: 0, extra: 0, extraBits: 0 };
}

function deflateRaw(src) {
  const w = bitWriter();
  w.writeBits(1, 1); // BFINAL
  w.writeBits(1, 2); // BTYPE = 01 fixed Huffman

  const WIN = 32768;
  const hash = new Map();
  const keyAt = i => (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
  let i = 0;
  while (i < src.length) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < src.length) {
      const list = hash.get(keyAt(i)) || [];
      for (let k = list.length - 1; k >= 0; k--) {
        const pos = list[k];
        const dist = i - pos;
        if (dist <= 0 || dist > WIN) break;
        let n = 0;
        while (n < 258 && i + n < src.length && src[pos + n] === src[i + n]) n++;
        if (n >= 3 && n > bestLen) {
          bestLen = n;
          bestDist = dist;
          if (n === 258) break;
        }
      }
    }
    if (bestLen >= 3) {
      const L = encodeLength(bestLen);
      const lit = litCode(L.sym);
      w.writeBits(lit.code, lit.len);
      if (L.extraBits) w.writeBits(L.extra, L.extraBits);
      const D = encodeDist(bestDist);
      const dc = distCode(D.sym);
      w.writeBits(dc.code, dc.len);
      if (D.extraBits) w.writeBits(D.extra, D.extraBits);
      for (let n = 0; n < bestLen; n++) {
        if (i + n + 2 < src.length) {
          const k = keyAt(i + n);
          const list = hash.get(k) || [];
          list.push(i + n);
          if (list.length > 16) list.shift();
          hash.set(k, list);
        }
      }
      i += bestLen;
    } else {
      const lit = litCode(src[i]);
      w.writeBits(lit.code, lit.len);
      if (i + 2 < src.length) {
        const k = keyAt(i);
        const list = hash.get(k) || [];
        list.push(i);
        if (list.length > 16) list.shift();
        hash.set(k, list);
      }
      i++;
    }
  }
  const eob = litCode(256);
  w.writeBits(eob.code, eob.len);
  return w.result();
}

/** 不压缩的 zlib 包装：大图（A4 RGB）用这个，避免 JS LZ77 卡死。 */
function storedZlib(src) {
  const blocks = [];
  let offset = 0;
  while (offset < src.length || offset === 0 && src.length === 0) {
    const n = Math.min(65535, src.length - offset);
    const last = offset + n >= src.length;
    const head = new Uint8Array(5);
    head[0] = last ? 0x01 : 0x00; // BFINAL=1/0, BTYPE=00, 已字节对齐
    head[1] = n & 0xff;
    head[2] = (n >> 8) & 0xff;
    head[3] = (~n) & 0xff;
    head[4] = ((~n) >> 8) & 0xff;
    blocks.push(head);
    if (n) blocks.push(src.subarray(offset, offset + n));
    offset += n;
    if (src.length === 0) break;
  }
  const rawLen = blocks.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(2 + rawLen + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let p = 2;
  blocks.forEach(b => { out.set(b, p); p += b.length; });
  const sum = adler32(src);
  out[p] = (sum >>> 24) & 0xff;
  out[p + 1] = (sum >>> 16) & 0xff;
  out[p + 2] = (sum >>> 8) & 0xff;
  out[p + 3] = sum & 0xff;
  return out;
}

function deflateZlib(src) {
  const raw = deflateRaw(src);
  const out = new Uint8Array(2 + raw.length + 4);
  out[0] = 0x78;
  out[1] = 0x01; // 无字典，最快档；校验：(0x7801 % 31) === 0
  out.set(raw, 2);
  const sum = adler32(src);
  const tail = 2 + raw.length;
  out[tail] = (sum >>> 24) & 0xff;
  out[tail + 1] = (sum >>> 16) & 0xff;
  out[tail + 2] = (sum >>> 8) & 0xff;
  out[tail + 3] = sum & 0xff;
  return out;
}

module.exports = { inflateRaw, inflateZlib, deflateZlib, storedZlib, adler32 };
