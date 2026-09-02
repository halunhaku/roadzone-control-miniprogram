const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildZones,
  defaults,
  mirrorZones,
  parseStake,
  speedLimits,
  stake,
  validate,
  zoneExtent,
} = require('../utils/calc');
const { signSchedule, signScheduleDouble } = require('../utils/schedule');
const {
  diagramLayout,
  laneSpecs,
  exportModel,
  drawRoadDiagram,
  drawA4DiagramPage,
  drawA4TablePage,
} = require('../utils/draw');

function mockCtx() {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    globalAlpha: 1,
    fillRect() {},
    strokeRect() {},
    fillText() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    rect() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    clip() {},
    translate() {},
    scale() {},
    setLineDash() {},
    drawImage() {},
  };
  return ctx;
}

describe('桩号工具', () => {
  it('解析常见桩号格式', () => {
    assert.equal(parseStake('K123+800'), 123800);
    assert.equal(parseStake('123＋050'), 123050);
    assert.equal(parseStake(' K0 + 005 '), 5);
    assert.equal(parseStake('100800'), 100800);
    assert.equal(parseStake('K12+1000'), null);
    assert.equal(parseStake('12.5+100'), null);
  });

  it('将米数格式化为标准桩号', () => {
    assert.equal(stake(123800), 'K123+800');
    assert.equal(stake(50), 'K0+050');
    assert.equal(stake(123800.6), 'K123+801');
  });
});

describe('分区计算', () => {
  it('上行严格使用用户输入长度，不做整百米对齐', () => {
    const zones = buildZones({ ...defaults, start: 'K123+800' });
    assert.deepEqual(zones.map(zone => zone.length), [1600, 200, 150, 1000, 30, 30]);
    assert.deepEqual(zones.map(zone => [zone.start, zone.end]), [
      [121850, 123450],
      [123450, 123650],
      [123650, 123800],
      [123800, 124800],
      [124800, 124830],
      [124830, 124860],
    ]);
    assert.equal(zones.reduce((sum, zone) => sum + zone.length, 0), 3010);
  });

  it('下行桩号按行车方向递减', () => {
    const zones = buildZones({ ...defaults, start: 'K123+800', direction: 'down' });
    assert.deepEqual(zones.map(zone => [zone.start, zone.end]), [
      [125750, 124150],
      [124150, 123950],
      [123950, 123800],
      [123800, 122800],
      [122800, 122770],
      [122770, 122740],
    ]);
  });

  it('双侧占路时两侧作业区范围重合、方向相反', () => {
    const zones = buildZones({ ...defaults, start: 'K123+800', workSide: 'median', doubleSide: true });
    const mirrored = mirrorZones(zones, 'up');
    assert.deepEqual([zones[3].start, zones[3].end], [123800, 124800]);
    assert.deepEqual([mirrored[3].start, mirrored[3].end], [124800, 123800]);
    assert.deepEqual(mirrored.map(zone => zone.length), zones.map(zone => zone.length));
    assert.deepEqual(zoneExtent(zones, mirrored), { min: 121850, max: 126750, span: 4900 });
  });
});

describe('参数校验', () => {
  it('默认模板合法', () => {
    assert.deepEqual(validate(defaults), {});
  });

  it('拦截当前模板的长度、间距和速度边界', () => {
    const cases = [
      ['work', 9], ['work', 4001], ['warning', 1599], ['warning', 1601],
      ['taper', 119], ['taper', 201], ['buffer', 99], ['buffer', 151],
      ['downstream', 29], ['terminal', 29], ['coneGap', 0], ['coneGap', 5],
      ['speed', 60], ['speed', 120],
    ];
    for (const [key, value] of cases) {
      assert.ok(validate({ ...defaults, [key]: value })[key], `应拦截 ${key}=${value}`);
    }
  });

  it('仅允许 80/100 两档设计速度', () => {
    assert.equal(validate({ ...defaults, speed: 80 }).speed, undefined);
    assert.equal(validate({ ...defaults, speed: 100 }).speed, undefined);
  });

  it('拦截会产生负桩号的上行、下行和双侧布置', () => {
    assert.ok(validate({ ...defaults, start: 'K1+949' }).start);
    assert.equal(validate({ ...defaults, start: 'K1+950' }).start, undefined);
    assert.ok(validate({ ...defaults, start: 'K1+059', direction: 'down' }).start);
    assert.equal(validate({ ...defaults, start: 'K1+060', direction: 'down' }).start, undefined);
    const doubleDown = { ...defaults, workSide: 'median', doubleSide: true, direction: 'down' };
    assert.ok(validate({ ...doubleDown, start: 'K2+949' }).start);
    assert.equal(validate({ ...doubleDown, start: 'K2+950' }).start, undefined);
  });

  it('双侧占路仅允许中央分隔带施工', () => {
    assert.ok(validate({ ...defaults, doubleSide: true, workSide: 'roadside' }).workSide);
  });
});

describe('限速牌与标志位置', () => {
  it('按设计速度切换逐级限速', () => {
    assert.deepEqual(speedLimits(100), { first: 80, final: 60 });
    assert.deepEqual(speedLimits(80), { first: 60, final: 40 });
  });

  it('警告区按 0/400/800/1000/1200 布设，无 800m 施工牌', () => {
    const rows = signSchedule(buildZones(defaults), 'up', 100);
    assert.deepEqual(rows.slice(0, 5).map(row => row[1]), [
      '前方施工 1600m',
      '关闭智驾',
      '限速 80',
      '限速 60',
      '禁止超车 / 车道减少',
    ]);
    assert.equal(rows.find(row => row[1].includes('导向'))[1], '导向标志牌');
    assert.equal(rows.find(row => row[1].includes('路栏'))[1], '路栏 / 作业区长度');
    assert.ok(!rows.some(row => /800m/.test(row[1]) && row[1] !== '距警告区起点 800m'));
    assert.ok(!rows.some(row => row[1] === '前方施工 800m'));
  });

  it('100km/h 模板输出 80→60，80km/h 模板输出 60→40', () => {
    const zones = buildZones(defaults);
    const rows100 = signSchedule(zones, 'up', 100);
    const rows80 = signSchedule(zones, 'up', 80);
    assert.equal(rows100[2][1], '限速 80');
    assert.equal(rows100[3][1], '限速 60');
    assert.equal(rows100[4][1], '禁止超车 / 车道减少');
    assert.match(rows100.at(-1)[1], /解除限速 60/);
    assert.equal(rows80[2][1], '限速 60');
    assert.equal(rows80[3][1], '限速 40');
    assert.match(rows80.at(-1)[1], /解除限速 40/);
  });

  it('标志桩号随上下行方向正确增减', () => {
    const upRows = signSchedule(buildZones(defaults), 'up', 100);
    const downRows = signSchedule(buildZones({ ...defaults, direction: 'down' }), 'down', 100);
    assert.equal(upRows[0][2], 'K121+850');
    assert.equal(upRows[1][2], 'K122+250');
    assert.equal(upRows[2][2], 'K122+650');
    assert.equal(upRows[3][2], 'K122+850');
    assert.equal(upRows[4][2], 'K123+050');
    assert.equal(downRows[0][2], 'K125+750');
    assert.equal(downRows[2][2], 'K124+950');
  });

  it('双侧布置输出两个方向的完整标志表', () => {
    const zones = buildZones({ ...defaults, workSide: 'median', doubleSide: true });
    const rows = signScheduleDouble(zones, 'up', 100);
    assert.equal(rows.length, 16);
    assert.match(rows[0][3], /^上行/);
    assert.match(rows[8][3], /^下行/);
  });
});

describe('纵向布置图与导出模型', () => {
  it('单侧一张图，双侧拆成上行/下行两张', () => {
    assert.equal(laneSpecs({ ...defaults, zones: buildZones(defaults), zoom: 1 }).length, 1);
    const double = laneSpecs({
      zones: buildZones({ ...defaults, workSide: 'median', doubleSide: true }),
      direction: 'up',
      workSide: 'median',
      doubleSide: true,
      coneGap: 4,
      speed: 100,
      zoom: 1,
    });
    assert.equal(double.length, 2);
    assert.equal(double[0].direction, 'up');
    assert.equal(double[1].direction, 'down');
    assert.ok(double[0].overview);
  });

  it('纵向图比宽更高，符合规程图式', () => {
    const layout = diagramLayout({ zones: buildZones(defaults), zoom: 1 });
    assert.ok(layout.viewH > layout.viewW);
    assert.ok(layout.viewW > 400);
    assert.ok(layout.viewH > 900);
  });

  it('双侧导出模型并排上下行桩号，不翻倍行数', () => {
    const params = { ...defaults, workSide: 'median', doubleSide: true };
    const zones = buildZones(params);
    const model = exportModel({
      params,
      zones,
      signRows: signSchedule(zones, params.direction, params.speed),
      total: zones.reduce((sum, zone) => sum + zone.length, 0),
      doubleSide: true,
    });
    assert.equal(model.zoneRows.length, 6);
    assert.equal(model.zoneRows[0].length, 7);
    assert.equal(model.exportSignRows[0].length, 5);
    assert.match(model.subtitle, /上\/下行/);
  });

  it('单侧与双侧图面、A4 分页绘制不抛错', () => {
    const ctx = mockCtx();
    const single = buildZones(defaults);
    assert.doesNotThrow(() => drawRoadDiagram(ctx, {
      zones: single,
      direction: 'up',
      workSide: 'roadside',
      coneGap: 4,
      speed: 100,
    }));

    const params = { ...defaults, workSide: 'median', doubleSide: true };
    const zones = buildZones(params);
    const specs = laneSpecs({
      zones,
      direction: 'up',
      workSide: 'median',
      doubleSide: true,
      coneGap: 4,
      speed: 80,
      zoom: 1,
    });
    const model = exportModel({
      params: { ...params, speed: 80 },
      zones,
      signRows: signSchedule(zones, 'up', 80),
      total: 3010,
      doubleSide: true,
    });
    specs.forEach(spec => {
      assert.doesNotThrow(() => drawRoadDiagram(ctx, spec));
      assert.doesNotThrow(() => drawA4DiagramPage(ctx, { spec, model, pageNo: 1, pageCount: 3 }));
    });
    assert.doesNotThrow(() => drawA4TablePage(ctx, { model, pageNo: 3, pageCount: 3 }));
  });

  it('有官方标志图时走 drawImage，不再画简化圆牌', () => {
    const calls = [];
    const ctx = mockCtx();
    ctx.drawImage = (img, x, y, w, h) => calls.push({ img, x, y, w, h });
    const fake = { width: 256, height: 256 };
    const images = {
      construction1600: fake, construction800: fake, smart: fake, limit80: fake,
      limit60: fake, laneRight: fake, length: fake, fence: fake, end60: fake,
      noOvertake: fake, endOvertake: fake, arrowLeft: fake,
    };
    drawRoadDiagram(ctx, {
      zones: buildZones(defaults),
      direction: 'up',
      workSide: 'roadside',
      coneGap: 4,
      speed: 100,
      signImages: images,
    });
    assert.ok(calls.length >= 10, `expected official sign images, got ${calls.length}`);
    assert.ok(calls.every(call => call.w === 42 && call.h === 42));
  });
});

describe('官方标志牌资源', () => {
  const { SIGN_TYPES } = require('../utils/signs');

  it('16 张官方标志 PNG 都已生成', () => {
    SIGN_TYPES.forEach(type => {
      const file = path.join(__dirname, '..', 'assets', 'signs', `${type}.png`);
      assert.ok(fs.existsSync(file), `missing ${type}.png`);
      assert.ok(fs.statSync(file).size > 1000, `${type}.png too small`);
    });
  });
});

describe('PDF 生成器', () => {
  const { buildPdf, A4 } = require('../utils/pdf');

  function fakeJpeg(n) {
    // 一个合法的极小 JPEG 并不必要——此处只验证 PDF 结构，
    // 用任意字节模拟 JPEG 二进制即可（DCTDecode 解码在查看器端）。
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, n & 0xff]);
  }

  function asText(bytes) {
    // byte[] -> latin-1 字符串，仅用于结构正则校验
    let s = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return s;
  }

  it('多页 A4 图能合成为结构合法的二进制 PDF', () => {
    const pages = [1, 2, 3].map(n => ({
      width: 2480,
      height: 3508,
      jpeg: fakeJpeg(n),
    }));
    const bin = buildPdf(pages, { title: '测试布置图' });
    assert.ok(bin instanceof Uint8Array, '应返回二进制字节数组');
    const pdf = asText(bin);
    assert.ok(pdf.startsWith('%PDF-1.4\n'));
    assert.ok(pdf.endsWith('%%EOF\n'));
    assert.ok(/\/Count 3\b/.test(pdf), '应有 3 页');
    assert.ok(/\/Type \/Catalog/.test(pdf));
    // JPEG 应以原始二进制内嵌（/DCTDecode 单层，不经过 ASCIIHex）
    assert.ok(pdf.indexOf('/Filter /DCTDecode') >= 0);
    assert.ok(pdf.indexOf('ASCIIHexDecode') < 0, '不应再用 ASCIIHex 包装');
  });

  it('JPEG 原始字节被逐字节嵌入 stream', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
    const bin = buildPdf([{ width: 100, height: 200, jpeg }]);
    // 原始字节必须原样出现（16 进制编码或 utf8 重写都会破坏它）
    let found = 0;
    const target = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9];
    for (let i = 0; i <= bin.length - target.length; i++) {
      let ok = true;
      for (let j = 0; j < target.length; j++) {
        if (bin[i + j] !== target[j]) { ok = false; break; }
      }
      if (ok) { found++; }
    }
    assert.ok(found >= 1, 'JPEG 原始字节应以二进制形式出现在 PDF 中');
  });

  it('xref 偏移指向正确的对象起始位置', () => {
    const pages = [{ width: 100, height: 200, jpeg: fakeJpeg(7) }];
    const pdf = asText(buildPdf(pages));
    const lines = pdf.split('\n');
    // 找到 trailer / Size
    const sizeLine = lines.find(l => /\/Size \d+/.test(l));
    assert.ok(sizeLine, '应找到 /Size 条目');
    const size = Number(sizeLine.replace(/.*\/Size (\d+).*/, '$1').trim());
    // 解析 xref 表（第一次出现 xref 的行）。对象 0 是 free-list 头，
    // 未使用的对象号是 free 条目，只校验实际使用(in-use, n)的对象。
    const xrefLine = lines.findIndex(l => l.trim() === 'xref');
    assert.ok(xrefLine > 0);
    let checked = 0;
    for (let i = 1; i < size; i++) {
      const m = /^(\d{10}) (\d{5}) ([nf])/.exec(lines[xrefLine + 2 + i]);
      assert.ok(m, `对象 ${i} 的 xref 条目缺失`);
      if (m[3] === 'f') continue; // free 条目跳过，offset 恒为 0
      const off = Number(m[1]);
      assert.ok(off > 0, `对象 ${i} 的 in-use 条目 offset 不应为 0`);
      const marker = `${i} 0 obj`;
      const slice = pdf.slice(off, off + marker.length);
      assert.equal(slice, marker, `对象 ${i} 的 xref 偏移 ${off} 应指向 "${marker}"`);
      checked++;
    }
    assert.ok(checked >= 4, `应至少校验到 4 个 in-use 对象，实际 ${checked}`);
  });

  it('空页抛错', () => {
    assert.throws(() => buildPdf([]));
  });

  it('能解开微信 readFile 的 { data } 包装，避免嵌进空图', () => {
    const jpeg = fakeJpeg(9);
    const wrapped = { data: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength), errMsg: 'readFile:ok' };
    const bin = buildPdf([{ width: 10, height: 10, jpeg: wrapped }]);
    let found = false;
    for (let i = 0; i <= bin.length - jpeg.length; i++) {
      let ok = true;
      for (let j = 0; j < jpeg.length; j++) {
        if (bin[i + j] !== jpeg[j]) { ok = false; break; }
      }
      if (ok) { found = true; break; }
    }
    assert.ok(found, '包装对象里的 JPEG 字节应被写入 PDF');
  });

  it('把整个 readFile res 当成 ArrayBuffer 会得到空图，现在应直接拒绝', () => {
    assert.throws(() => buildPdf([{ width: 10, height: 10, jpeg: { errMsg: 'readFile:ok' } }]));
    assert.throws(() => buildPdf([{ width: 10, height: 10, jpeg: new Uint8Array([0x00, 0x01, 0x02, 0x03]) }]));
  });

  it('微信 canvas 常见的 PNG 页也能合成 PDF', () => {
    const png = fs.readFileSync(path.join(__dirname, '..', 'assets', 'signs', 'limit80.png'));
    const bin = buildPdf([{ width: 256, height: 256, jpeg: png }], { title: 'png页' });
    const pdf = asText(bin);
    assert.ok(pdf.startsWith('%PDF-1.4\n'));
    assert.ok(pdf.indexOf('/Filter /FlateDecode') >= 0);
    assert.ok(bin.length > 1000);
  });
});

describe('PNG / zlib', () => {
  const zlib = require('node:zlib');
  const { inflateRaw, deflateZlib } = require('../utils/zlib');
  const { decodePng } = require('../utils/png');

  it('inflate 能解开 Node zlib 压出的 raw deflate', () => {
    const src = Buffer.from('hello roadzone inflate test 你好');
    const raw = zlib.deflateRawSync(src);
    const out = inflateRaw(new Uint8Array(raw));
    assert.deepEqual(Buffer.from(out), src);
  });

  it('deflate 后能被 Node zlib 解开', () => {
    const src = Buffer.from('AAAABBBBCCCC roadzone compress 1234567890'.repeat(20));
    const z = deflateZlib(new Uint8Array(src));
    const back = zlib.inflateSync(Buffer.from(z));
    assert.deepEqual(back, src);
  });

  it('stored zlib 能被 Node 解开，并可用于 RGB 页', () => {
    const { storedZlib } = require('../utils/zlib');
    const src = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const z = storedZlib(new Uint8Array(src));
    assert.deepEqual(zlib.inflateSync(Buffer.from(z)), src);
    const { buildPdf } = require('../utils/pdf');
    const bin = buildPdf([{ width: 1, height: 1, rgb: new Uint8Array([10, 20, 30]) }]);
    assert.ok(bin[0] === 0x25 && bin[1] === 0x50 && bin[2] === 0x44 && bin[3] === 0x46);
    const ascii = String.fromCharCode.apply(null, bin.subarray(0, 400));
    assert.ok(ascii.indexOf('/Filter /FlateDecode') >= 0);
  });

  it('能解码官方标志 PNG 为 RGB', () => {
    const png = fs.readFileSync(path.join(__dirname, '..', 'assets', 'signs', 'limit80.png'));
    const img = decodePng(new Uint8Array(png));
    assert.equal(img.width, 256);
    assert.equal(img.height, 256);
    assert.equal(img.rgb.length, 256 * 256 * 3);
  });
});

