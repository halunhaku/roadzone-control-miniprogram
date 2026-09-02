/**
 * 极简 PDF 生成器（无第三方依赖）。
 *
 * 用途：把由 canvas 生成的一张张 JPEG 页（A4 竖版图）合并成一个 PDF 文件。
 *
 * 实现要点（对移动端渲染器兼容性最佳）：
 *  - 每张 JPEG 以「原始二进制字节」通过 /DCTDecode 单层滤镜直接内嵌到 stream，
 *    这是 jspdf 等成熟库的标准做法，iOS/Android 系统 PDF 渲染器均可正确显示。
 *    避免使用嵌套滤镜（如 ASCIIHexDecode 包裹 DCTDecode）——那在部分移动端
 *    渲染器上会导致图片空白。
 *  - 因此输出的是「二进制 PDF」（Uint8Array / ArrayBuffer），写入本地文件时
 *    用 FileSystemManager.writeFile 传 ArrayBuffer，utf8 字符串形式会损坏 JPEG 字节。
 *  - 每页一张图，铺满整张 A4 页。
 *  - 文本部分（xref / 结构 / 标题）均为纯 ASCII，标题用 UTF-16BE 十六进制字面量表示，
 *    保证字节偏移计算准确。
 */

const A4 = { w: 595.28, h: 841.89 }; // PDF 单位：pt（A4 纵向）

/** 将所有片段（ASCII 字符串 或 Uint8Array）拼接为一个 Uint8Array（返回 ArrayBuffer 前置 .buffer）。 */
function concatBytes(chunks) {
  let total = 0;
  chunks.forEach(c => {
    total += typeof c === 'string' ? c.length : c.length;
  });
  const out = new Uint8Array(total);
  let pos = 0;
  chunks.forEach(c => {
    if (typeof c === 'string') {
      for (let i = 0; i < c.length; i++) out[pos++] = c.charCodeAt(i) & 0xff;
    } else {
      out.set(c, pos);
      pos += c.length;
    }
  });
  return out;
}

/** 把 JS 字符串编码为 UTF-16BE 的 PDF <hex> 字符串字面量（PDF 文本含中文时用）。 */
function utf16Hex(s) {
  let hex = '<FEFF';
  for (const ch of String(s)) {
    let cp = ch.codePointAt(0);
    if (cp > 0xffff) cp = 0xfffd; // 超出 BMP 的罕见字符降级
    hex += cp.toString(16).padStart(4, '0');
  }
  return hex + '>';
}

const { storedZlib } = require('./zlib');
const { decodePng } = require('./png');

function rgbaToRgb(rgba) {
  const n = (rgba.length / 4) | 0;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    rgb[i * 3] = rgba[j];
    rgb[i * 3 + 1] = rgba[j + 1];
    rgb[i * 3 + 2] = rgba[j + 2];
  }
  return rgb;
}

/**
 * 把各种输入收敛成图片字节。
 * 微信 FileSystemManager.readFile 的 success 回调给的是 { data }，
 * 部分基础库还会给 latin1 字符串；都要能解开。
 */
function asImageBytes(input) {
  if (!input) throw new Error('buildPdf: 缺少图片数据');
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (typeof input === 'string') {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xff;
    return bytes;
  }
  if (input.data) return asImageBytes(input.data);
  throw new Error('buildPdf: 图片数据格式无效');
}

function isJpeg(bytes) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isPng(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function encodeImage(page) {
  if (page.rgb || page.rgba) {
    const rgb = page.rgb || rgbaToRgb(page.rgba);
    return {
      width: page.width,
      height: page.height,
      filter: '/FlateDecode',
      body: storedZlib(rgb),
    };
  }
  const bytes = asImageBytes(page.jpeg != null ? page.jpeg : page.data);
  if (isJpeg(bytes)) {
    return {
      width: page.width,
      height: page.height,
      filter: '/DCTDecode',
      body: bytes,
    };
  }
  if (isPng(bytes)) {
    const png = decodePng(bytes);
    return {
      width: png.width,
      height: png.height,
      filter: '/FlateDecode',
      body: storedZlib(png.rgb),
    };
  }
  throw new Error('buildPdf: 仅支持 JPEG / PNG / RGB');
}

/** 取出 Uint8Array 对应的精确 ArrayBuffer，避免 .buffer 带上别的 view 偏移。 */
function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * 把若干 JPEG 图片页合并为一个二进制 PDF。
 * @param {Array<{width:number, height:number, jpeg: ArrayBuffer|Uint8Array}>} pages
 * @param {Object} [opts]
 * @param {string} [opts.title] PDF 标题（元数据，支持中文）
 * @param {number} [opts.pagePtWidth=A4.w]
 * @param {number} [opts.pagePtHeight=A4.h]
 * @returns {Uint8Array} 完整 PDF 字节（用 .buffer 可作为 ArrayBuffer 写入文件）
 */
function buildPdf(pages, opts = {}) {
  const pageW = opts.pagePtWidth || A4.w;
  const pageH = opts.pagePtHeight || A4.h;
  if (!pages || pages.length === 0) {
    throw new Error('buildPdf: 没有可写入的页面');
  }

  const chunks = [];
  const offsets = []; // 各对象字节偏移（用于 xref）
  const used = {};
  let byteLen = 0; // 已写入的累计字节数
  const begin = objNum => {
    offsets[objNum] = byteLen;
    used[objNum] = true;
    chunks.push(`${objNum} 0 obj\n`);
    byteLen += `${objNum} 0 obj\n`.length;
  };
  const emit = chunk => {
    chunks.push(chunk);
    byteLen += typeof chunk === 'string' ? chunk.length : chunk.length;
  };

  // 对象号分配
  const imgObj = i => 10 + i;
  const streamObj = i => 100 + i;
  const pageObj = i => 200 + i;
  const infoObj = pages.length * 1000 + 1;

  emit('%PDF-1.4\n');
  emit('%\xE2\xE3\xCF\xD3\n'); // 二进制注释行标记

  // 1. 图像对象：JPEG 走 /DCTDecode；PNG（微信 canvas 常见）解码后走 /FlateDecode
  for (let i = 0; i < pages.length; i++) {
    const img = encodeImage(pages[i]);
    const header =
      `<< /Type /XObject /Subtype /Image ` +
      `/Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter ${img.filter} ` +
      `/Length ${img.body.length} >>\nstream\n`;
    begin(imgObj(i));
    emit(header);
    emit(img.body);
    emit('\nendstream\nendobj\n');
  }

  // 2. 页面内容流：把对应图片缩放铺满整页
  for (let i = 0; i < pages.length; i++) {
    const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im${i} Do\nQ\n`;
    begin(streamObj(i));
    emit(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  }

  // 3. 页面对象
  const pageRefs = [];
  for (let i = 0; i < pages.length; i++) {
    pageRefs.push(`${pageObj(i)} 0 R`);
    begin(pageObj(i));
    emit(
      `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${pageW} ${pageH}] ` +
        `/Contents ${streamObj(i)} 0 R ` +
        `/Resources << /XObject << /Im${i} ${imgObj(i)} 0 R >> >> ` +
        `>>\nendobj\n`,
    );
  }

  // 4. Pages 树
  begin(2);
  emit(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>\nendobj\n`);

  // 5. Catalog
  begin(1);
  emit(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  // 6. Info（标题用 UTF-16BE hex 字符串，保证 ASCII）
  begin(infoObj);
  emit(`<< /Title ${utf16Hex(opts.title || 'RoadZone')} /Producer (RoadZone MiniProgram) >>\nendobj\n`);

  // 7. xref + trailer（未使用的对象号记为 free 条目，避免悬空引用）
  const xrefPos = byteLen;
  const count = infoObj + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    if (used[i]) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    } else {
      xref += `0000000000 65535 f \n`;
    }
  }
  emit(xref);
  emit(
    `trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoObj} 0 R >>\n` +
      `startxref\n${xrefPos}\n%%EOF\n`,
  );

  return concatBytes(chunks);
}

module.exports = { buildPdf, A4, asImageBytes, toArrayBuffer };
