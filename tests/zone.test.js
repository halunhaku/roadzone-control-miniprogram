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

  it('100km/h 模板输出 80→60，80km/h 模板输出 60→40', () => {
    const zones = buildZones(defaults);
    const rows100 = signSchedule(zones, 'up', 100);
    const rows80 = signSchedule(zones, 'up', 80);
    assert.equal(rows100[2][1], '限速 80');
    assert.equal(rows100[4][1], '限速 60');
    assert.match(rows100.at(-1)[1], /解除限速 60/);
    assert.equal(rows80[2][1], '限速 60');
    assert.equal(rows80[4][1], '限速 40');
    assert.match(rows80.at(-1)[1], /解除限速 40/);
  });

  it('标志桩号随上下行方向正确增减', () => {
    const upRows = signSchedule(buildZones(defaults), 'up', 100);
    const downRows = signSchedule(buildZones({ ...defaults, direction: 'down' }), 'down', 100);
    assert.equal(upRows[0][2], 'K121+850');
    assert.equal(upRows[2][2], 'K122+450');
    assert.equal(downRows[0][2], 'K125+750');
    assert.equal(downRows[2][2], 'K125+150');
  });

  it('双侧布置输出两个方向的完整标志表', () => {
    const zones = buildZones({ ...defaults, workSide: 'median', doubleSide: true });
    const rows = signScheduleDouble(zones, 'up', 100);
    assert.equal(rows.length, 18);
    assert.match(rows[0][3], /^上行/);
    assert.match(rows[9][3], /^下行/);
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
