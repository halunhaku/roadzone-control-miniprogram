/* ── Canvas 绘制层：与 Web 端 RoadDiagram.tsx / export.ts 纵向图式对齐 ──
 *
 * 逻辑坐标：
 *   - 布置图：viewW × viewH（diagramLayout）
 *   - A4 图纸：794 × 1123，调用方 setTransform(W/794, …) 后绘制
 * 页面负责设置 ctx transform 与清屏；本模块不触碰 transform。
 *
 * 双侧占路拆成上行、下行两张单车道图，每张角落带总平面缩略图。
 */

const { stake, warningSignOffsets, mirrorZones, zoneExtent, speedLimits } = require('./calc');
const { signRowsOf } = require('./schedule');

const SCHEME_PX = {
  warning: 500,
  taper: 76,
  buffer: 66,
  work: 176,
  downstream: 74,
  terminal: 74,
};

const ZONE_LETTER = {
  warning: 'S',
  taper: 'L₁',
  buffer: 'H',
  work: 'G',
  downstream: 'L₂',
  terminal: 'Z',
};

const C = {
  road: '#6DB5D1',
  shoulder: '#D4D4D4',
  median: '#C5C5C5',
  hatch: '#2F2F2F',
  cone: '#D42128',
  post: '#1A1A1A',
  mark: '#FFFFFF',
  dim: '#222222',
  muted: '#5A5A5A',
  bg: '#FFFFFF',
};

const LANE = 48;
const SHOULDER = 30;
const MEDIAN = 26;
const SIGN_COL = 86;
const DIM_COL = 82;
const GUTTER = 14;
const PAD = 24;
const SIGN_SIZE = 42;
const OVERVIEW_W = 124;
const OVERVIEW_H = 276;
const OVERVIEW_GAP = 10;

const A4 = { w: 794, h: 1123 };

const SIGN_LABELS = {
  construction1600: '1600',
  construction800: '800',
  length: '长度',
  smart: '智驾',
  limit80: '80',
  limit60: '60',
  limit40: '40',
  laneLeft: '减道',
  laneRight: '减道',
  noOvertake: '禁超',
  arrowLeft: '导向',
  arrowRight: '导向',
  end60: '解60',
  end40: '解40',
  endOvertake: '解禁',
  fence: '路栏',
};

/* ── 工具 ────────────────────────────────────────────── */

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function cellBaseline(h, s) {
  return Math.round((h - s) / 2 + s * 0.82);
}

function zonePixels(zones, zoom) {
  return zones.map(zone => (SCHEME_PX[zone.key] || 54) * zoom);
}

function dotsAlong(a0, a1, c0, c1, spacing) {
  const da = a1 - a0;
  const dc = c1 - c0;
  const len = Math.hypot(da, dc);
  const count = Math.max(3, Math.round(len / Math.max(8, spacing)));
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    return { along: a0 + da * t, across: c0 + dc * t };
  });
}

function fillHatch(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.hatch;
  ctx.lineWidth = 1.4;
  const step = 7;
  const extra = w + h;
  for (let i = -extra; i < extra; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

/* ── 标志牌（canvas 简化面，语义与 Web 标志牌一致） ── */

function drawSignFace(ctx, x, y, type, size, images) {
  const s = size || SIGN_SIZE;
  const img = images && images[type];
  if (img) {
    ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
    return;
  }
  const r = s / 2;
  ctx.save();
  ctx.translate(x, y);

  const ended = type === 'end60' || type === 'end40' || type === 'endOvertake';
  const limit = type === 'limit80' || type === 'limit60' || type === 'limit40';
  const guide = type === 'arrowLeft' || type === 'arrowRight';
  const fence = type === 'fence';
  const lane = type === 'laneLeft' || type === 'laneRight';
  const smart = type === 'smart';
  const label = SIGN_LABELS[type] || '标志';

  if (fence) {
    ctx.fillStyle = '#f2994a';
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 1.4;
    ctx.fillRect(-r + 4, -r + 10, s - 8, s - 20);
    ctx.strokeRect(-r + 4, -r + 10, s - 8, s - 20);
    ctx.fillStyle = '#202020';
    const stripe = 5;
    for (let i = -r + 4; i < r - 4; i += stripe * 2) {
      ctx.fillRect(i, -r + 10, stripe, s - 20);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '700 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
    return;
  }

  if (guide || lane || smart) {
    ctx.fillStyle = guide ? '#f2994a' : '#fff';
    ctx.strokeStyle = '#e08a1e';
    ctx.lineWidth = 2.4;
    roundRect(ctx, -r + 2, -r + 1, s - 4, s - 2, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1d1d1f';
    ctx.font = '700 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = ended ? '#f2f2f7' : '#fff';
  ctx.strokeStyle = ended ? '#8e8e93' : limit ? '#c0111e' : '#e08a1e';
  ctx.lineWidth = 2.6;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1d1d1f';
  ctx.font = `700 ${label.length > 2 ? 9 : 11}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);

  if (ended) {
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r + 8, r - 8);
    ctx.lineTo(r - 8, -r + 8);
    ctx.stroke();
  }

  ctx.restore();
}

/* ── 布局 ────────────────────────────────────────────── */

function alongMapper(zones, zoom, overviewZones) {
  const primaryPx = zonePixels(zones, zoom);
  if (overviewZones) {
    const extent = zoneExtent(overviewZones.up, overviewZones.down);
    const ppm = primaryPx.reduce((sum, px) => sum + px, 0) / Math.max(1, zones.reduce((sum, zone) => sum + zone.length, 0));
    const totalAlong = Math.max(1, extent.span) * ppm;
    return {
      totalAlong,
      alongOf(meters) {
        return (meters - extent.min) * ppm;
      },
    };
  }
  const starts = primaryPx.reduce((list, px) => {
    list.push((list[list.length - 1] || 0) + px);
    return list;
  }, [0]);
  const totalAlong = starts[starts.length - 1] || 1;
  return {
    totalAlong,
    alongOf(meters) {
      for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];
        const span = zone.end - zone.start;
        if (span === 0) continue;
        const t = (meters - zone.start) / span;
        if (t >= -1e-6 && t <= 1 + 1e-6) {
          return (starts[i] || 0) + t * primaryPx[i];
        }
      }
      const first = zones[0];
      const last = zones[zones.length - 1];
      const firstT = (meters - first.start) / Math.max(1e-6, first.end - first.start);
      if (firstT < 0) return firstT * primaryPx[0];
      return totalAlong + (meters - last.end) / Math.max(1e-6, last.end - last.start) * (primaryPx[primaryPx.length - 1] || 0);
    },
  };
}

/**
 * 单张纵向布置图的逻辑尺寸。
 * @param {Object} opts
 * @param {Array} opts.zones
 * @param {number} [opts.zoom=1]
 * @param {boolean} [opts.overview] 是否预留总平面缩略图列
 */
function diagramLayout(opts) {
  const zoom = opts.zoom == null ? 1 : opts.zoom;
  const mapped = alongMapper(opts.zones, zoom, null);
  const roadW = MEDIAN + LANE * 2 + SHOULDER;
  const overviewCol = opts.overview ? OVERVIEW_W + OVERVIEW_GAP : 0;
  const leftCol = SIGN_COL + GUTTER + overviewCol;
  const rightCol = SIGN_COL + DIM_COL + GUTTER + 88;
  const topCol = 28;
  const botCol = 40;
  return {
    viewW: PAD + leftCol + roadW + rightCol + PAD,
    viewH: PAD + topCol + mapped.totalAlong + botCol + PAD,
    roadW,
    leftCol,
    rightCol,
    topCol,
    botCol,
    totalAlong: mapped.totalAlong,
  };
}

/* ── 总平面缩略图 ────────────────────────────────────── */

function drawOverview(ctx, x, y, upZones, downZones, focus) {
  const extent = zoneExtent(upZones, downZones);
  const titleH = 18;
  const footH = 16;
  const innerY = y + titleH + 4;
  const innerH = OVERVIEW_H - titleH - footH - 10;
  const sh = 6;
  const lane = 11;
  const med = 8;
  const roadW = sh + lane * 2 + med + lane * 2 + sh;
  const ox = x + (OVERVIEW_W - roadW) / 2;
  const yOf = meters => innerY + innerH - ((meters - extent.min) / Math.max(1, extent.span)) * innerH;
  const band = (a, b) => {
    const y0 = Math.min(yOf(a), yOf(b));
    return { y: y0, h: Math.max(1.2, Math.abs(yOf(b) - yOf(a))) };
  };
  const down = { sh0: 0, open0: sh, open1: sh + lane, closed0: sh + lane, closed1: sh + lane * 2 };
  const up = {
    closed0: sh + lane * 2 + med,
    closed1: sh + lane * 2 + med + lane,
    open0: sh + lane * 2 + med + lane,
    open1: sh + lane * 2 + med + lane * 2,
    sh1: sh + lane * 2 + med + lane * 2,
  };

  ctx.save();
  roundRect(ctx, x, y, OVERVIEW_W, OVERVIEW_H, 3);
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#1d1d1f';
  ctx.lineWidth = 0.8;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1d1d1f';
  ctx.font = '700 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('总平面', x + 8, y + 14);
  ctx.fillStyle = '#007aff';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'end';
  ctx.fillText(`本图：${focus === 'up' ? '上行' : '下行'}`, x + OVERVIEW_W - 8, y + 14);

  ctx.fillStyle = C.shoulder;
  ctx.fillRect(ox, innerY, roadW, innerH);
  ctx.fillStyle = C.road;
  ctx.fillRect(ox + down.open0, innerY, lane, innerH);
  ctx.fillRect(ox + down.closed0, innerY, lane, innerH);
  ctx.fillStyle = C.median;
  ctx.fillRect(ox + sh + lane * 2, innerY, med, innerH);
  ctx.fillStyle = C.road;
  ctx.fillRect(ox + up.closed0, innerY, lane, innerH);
  ctx.fillRect(ox + up.open0, innerY, lane, innerH);

  const paintLane = (laneZones, closed0, closed1, opacity) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    laneZones.forEach(zone => {
      const box = band(zone.start, zone.end);
      if (zone.key === 'work') {
        fillHatch(ctx, ox + closed0, box.y, closed1 - closed0, box.h);
      } else {
        ctx.fillStyle = zone.color;
        ctx.globalAlpha = opacity * 0.72;
        ctx.fillRect(ox + closed0, box.y, closed1 - closed0, box.h);
      }
    });
    ctx.restore();
  };
  paintLane(downZones, down.closed0, down.closed1, focus === 'down' ? 1 : 0.32);
  paintLane(upZones, up.closed0, up.closed1, focus === 'up' ? 1 : 0.32);

  ctx.strokeStyle = '#007aff';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(
    ox + (focus === 'down' ? 0 : sh + lane * 2 + med) - 1.5,
    innerY - 1.5,
    sh + lane * 2 + 3,
    innerH + 3,
  );

  const arrow = (cx, cy, dir, fill, opacity) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = fill;
    const tip = cy + dir * -7;
    ctx.beginPath();
    ctx.moveTo(cx, tip);
    ctx.lineTo(cx - 4, tip + dir * 9);
    ctx.lineTo(cx + 4, tip + dir * 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  arrow(ox + (down.open0 + down.open1) / 2, innerY + innerH * 0.22, -1, focus === 'down' ? '#007aff' : '#fff', focus === 'down' ? 1 : 0.45);
  arrow(ox + (up.open0 + up.open1) / 2, innerY + innerH * 0.78, 1, focus === 'up' ? '#007aff' : '#fff', focus === 'up' ? 1 : 0.45);

  ctx.font = `${focus === 'down' ? '700' : '400'} 9px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = focus === 'down' ? '#007aff' : '#3a3a3c';
  ctx.fillText(focus === 'down' ? '下行·本图' : '下行', ox + sh + lane, y + OVERVIEW_H - 6);
  ctx.font = `${focus === 'up' ? '700' : '400'} 9px sans-serif`;
  ctx.fillStyle = focus === 'up' ? '#007aff' : '#3a3a3c';
  ctx.fillText(focus === 'up' ? '上行·本图' : '上行', ox + sh + lane * 3 + med, y + OVERVIEW_H - 6);
  ctx.restore();
}

/* ── 单张纵向布置图 ──────────────────────────────────── */

function buildCarriage(dir, laneZones, across0, innerFirst, alongOf, closeInner) {
  const travel = alongOf(laneZones[0].end) >= alongOf(laneZones[0].start) ? 1 : -1;
  let inner0;
  let inner1;
  let outer0;
  let outer1;
  if (innerFirst) {
    inner0 = across0;
    inner1 = across0 + LANE;
    outer0 = inner1;
    outer1 = inner1 + LANE;
  } else {
    outer0 = across0;
    outer1 = across0 + LANE;
    inner0 = outer1;
    inner1 = outer1 + LANE;
  }
  const closed0 = closeInner ? inner0 : outer0;
  const closed1 = closeInner ? inner1 : outer1;
  const open0 = closeInner ? outer0 : inner0;
  const open1 = closeInner ? outer1 : inner1;
  return {
    dir,
    zones: laneZones,
    travel,
    inner0,
    inner1,
    outer0,
    outer1,
    laneLine: innerFirst ? inner1 : outer1,
    closed0,
    closed1,
    open0,
    open1,
    openMid: (open0 + open1) / 2,
    closedMid: (closed0 + closed1) / 2,
    innerEdge: innerFirst ? inner0 : inner1,
    outerEdge: innerFirst ? outer1 : outer0,
  };
}

/**
 * 绘制一张纵向规程布置图。
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} opts
 * @param {Array} opts.zones
 * @param {'up'|'down'} opts.direction
 * @param {'roadside'|'median'} opts.workSide
 * @param {number} opts.coneGap
 * @param {number} opts.speed
 * @param {number} [opts.zoom=1]
 * @param {'up'|'down'} [opts.crossSectionFocus]
 * @param {{up:Array,down:Array}} [opts.overview]
 */
function drawRoadDiagram(ctx, opts) {
  const {
    zones, direction, workSide, coneGap, speed,
    zoom = 1, crossSectionFocus, overview,
  } = opts;
  const closeInner = workSide === 'median';
  const limits = speedLimits(speed);
  const warnTypes = {
    0: 'construction1600',
    400: 'smart',
    600: limits.first === 80 ? 'limit80' : 'limit60',
    800: 'construction800',
    1000: limits.final === 60 ? 'limit60' : 'limit40',
    1200: closeInner ? 'laneLeft' : 'laneRight',
  };
  const guideType = closeInner ? 'arrowRight' : 'arrowLeft';
  const endSpeed = limits.final === 60 ? 'end60' : 'end40';
  const coneStep = Math.max(10, 15 * (coneGap / 4));

  const mapped = alongMapper(zones, zoom, null);
  const { totalAlong, alongOf } = mapped;
  const roadW = MEDIAN + LANE * 2 + SHOULDER;
  const overviewCol = overview && crossSectionFocus ? OVERVIEW_W + OVERVIEW_GAP : 0;
  const leftCol = SIGN_COL + GUTTER + overviewCol;
  const rightCol = SIGN_COL + DIM_COL + GUTTER + 88;
  const topCol = 28;
  const botCol = 40;
  const viewW = PAD + leftCol + roadW + rightCol + PAD;
  const viewH = PAD + topCol + totalAlong + botCol + PAD;
  const roadX = PAD + leftCol;
  const roadY = PAD + topCol;
  const roadEndAlong = roadY + totalAlong;

  const xy = (along, across) => ({ x: roadX + across, y: roadEndAlong - along });
  const strip = (a0, a1, c0, c1) => {
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    return {
      x: roadX + Math.min(c0, c1),
      y: roadEndAlong - hi,
      w: Math.abs(c1 - c0),
      h: hi - lo,
    };
  };

  const alongAt = (laneZones, index, offset) => {
    const zone = laneZones[index];
    const t = offset / Math.max(1, zone.length);
    return alongOf(zone.start) + (alongOf(zone.end) - alongOf(zone.start)) * t;
  };

  const carriage = buildCarriage(direction, zones, MEDIAN, true, alongOf, closeInner);
  const carriages = [carriage];
  const median0 = 0;
  const median1 = MEDIAN;
  const alongStart = 0;
  const alongEnd = totalAlong;

  const collectSigns = car => {
    const marks = [];
    const warn = car.zones[0];
    const warnOffsets = warningSignOffsets.filter(offset => offset <= warn.length);
    const warnStart = alongAt(car.zones, 0, 0);
    const warnLast = alongAt(car.zones, 0, warnOffsets[warnOffsets.length - 1] || 0);
    const warnDir = Math.sign(warnLast - warnStart) || 1;
    const warnFirst = warnStart + warnDir * (SIGN_SIZE / 2 + 6);
    warnOffsets.forEach((offset, index) => {
      const t = warnOffsets.length === 1 ? 0 : index / (warnOffsets.length - 1);
      const type = warnTypes[offset];
      const along = warnFirst + (warnLast - warnFirst) * t;
      marks.push({ along, type, side: 'work' });
      if (type === 'construction1600' || type === 'construction800') {
        marks.push({ along, type, side: 'opp' });
      }
    });
    marks.push({
      along: alongAt(car.zones, 1, Math.min(50, car.zones[1].length)),
      type: guideType,
      side: 'work',
      label: '导向标志',
      onRoad: true,
    });
    const bufferStart = alongAt(car.zones, 2, 0);
    const bufferTravel = Math.sign(alongAt(car.zones, 2, car.zones[2].length) - bufferStart) || 1;
    marks.push({ along: bufferStart, type: 'length', side: 'work' });
    marks.push({
      along: bufferStart,
      type: 'fence',
      side: 'work',
      label: '路栏',
      signAlong: bufferStart + bufferTravel * (SIGN_SIZE + 22),
      onRoad: true,
    });
    marks.push({ along: alongAt(car.zones, 5, car.zones[5].length), type: endSpeed, side: 'work' });
    if (warnOffsets.indexOf(1200) >= 0) {
      marks.push({ along: warnLast, type: 'noOvertake', side: 'opp' });
    }
    marks.push({ along: alongAt(car.zones, 5, car.zones[5].length), type: 'endOvertake', side: 'opp' });
    return marks;
  };

  const signOnLeft = (car, side) => {
    const workLeft = closeInner;
    return side === 'work' ? workLeft : !workLeft;
  };
  const signColumnAcross = (car, side, offset) => {
    const onLeft = signOnLeft(car, side);
    return (onLeft ? 0 : roadW) + (onLeft ? -1 : 1) * (GUTTER + SIGN_SIZE / 2 + offset);
  };
  const stagger = marks => {
    const bySide = { work: [], opp: [] };
    marks.forEach(mark => bySide[mark.side].push(mark));
    const placed = [];
    ['work', 'opp'].forEach(side => {
      const list = bySide[side].slice().sort((a, b) => (a.signAlong != null ? a.signAlong : a.along) - (b.signAlong != null ? b.signAlong : b.along));
      let last = -Infinity;
      list.forEach(mark => {
        let signAlong = mark.signAlong != null ? mark.signAlong : mark.along;
        const gap = SIGN_SIZE + 12;
        if (mark.signAlong == null && Number.isFinite(last) && Math.abs(signAlong - last) < gap) {
          signAlong = last + Math.sign(signAlong - last || 1) * gap;
        }
        placed.push(Object.assign({}, mark, { signAlong, shift: mark.shift || 0 }));
        last = signAlong;
      });
    });
    return placed;
  };

  const cones = [];
  carriages.forEach(car => {
    const closedEdge = closeInner ? car.innerEdge : car.outerEdge;
    const taperA0 = alongAt(car.zones, 1, 0);
    const taperA1 = alongAt(car.zones, 1, car.zones[1].length);
    const downA0 = alongAt(car.zones, 4, 0);
    const downA1 = alongAt(car.zones, 4, car.zones[4].length);
    const workA0 = alongAt(car.zones, 2, 0);
    const workA1 = alongAt(car.zones, 3, car.zones[3].length);
    const workStart = alongAt(car.zones, 3, 0);
    const acrossGap = Math.max(8, coneStep * 0.6);
    cones.push(
      ...dotsAlong(taperA0, taperA1, closedEdge, car.laneLine, coneStep),
      ...dotsAlong(workA0, workA1, car.laneLine, car.laneLine, coneStep),
      ...dotsAlong(downA0, downA1, car.laneLine, closedEdge, coneStep),
      ...dotsAlong(taperA1, taperA1, closedEdge, car.laneLine, acrossGap),
      ...dotsAlong(workStart, workStart, closedEdge, car.laneLine, acrossGap),
      ...dotsAlong(workA1, workA1, closedEdge, car.laneLine, acrossGap),
    );
  });

  const arrows = [];
  carriages.forEach(car => {
    const a0 = alongAt(car.zones, 0, car.zones[0].length * 0.18);
    const a1 = alongAt(car.zones, 0, car.zones[0].length * 0.55);
    const a2 = alongAt(car.zones, 3, car.zones[3].length * 0.45);
    [a0, a1, a2].forEach(along => arrows.push({ along, across: car.openMid, travel: car.travel }));
  });

  const allSigns = carriages.reduce((list, car) => {
    stagger(collectSigns(car)).forEach(mark => list.push(Object.assign({ carriage: car }, mark)));
    return list;
  }, []);

  const onRoadPostAcross = (car, item) => {
    const closedEdge = closeInner ? car.innerEdge : car.outerEdge;
    const isGuide = item.type === 'arrowLeft' || item.type === 'arrowRight';
    if (isGuide) {
      const taperA0 = alongAt(car.zones, 1, 0);
      const taperA1 = alongAt(car.zones, 1, car.zones[1].length);
      const span = taperA1 - taperA0;
      const t = span === 0 ? 0 : Math.max(0, Math.min(1, (item.along - taperA0) / span));
      const coneAcross = closedEdge + t * (car.laneLine - closedEdge);
      return (coneAcross + closedEdge) / 2;
    }
    return (car.laneLine + closedEdge) / 2;
  };
  const shoulderPostAcross = (car, side) => (signOnLeft(car, side) ? MEDIAN / 2 : roadW - SHOULDER / 2);

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, viewW, viewH);

  if (overview && crossSectionFocus) {
    drawOverview(ctx, PAD, PAD, overview.up, overview.down, crossSectionFocus);
  }

  const med = strip(alongStart, alongEnd, 0, MEDIAN);
  const sh = strip(alongStart, alongEnd, MEDIAN + LANE * 2, roadW);
  ctx.fillStyle = C.median;
  ctx.fillRect(med.x, med.y, med.w, med.h);
  ctx.fillStyle = C.shoulder;
  ctx.fillRect(sh.x, sh.y, sh.w, sh.h);

  carriages.forEach(car => {
    const inner = strip(alongStart, alongEnd, car.inner0, car.inner1);
    const outer = strip(alongStart, alongEnd, car.outer0, car.outer1);
    ctx.fillStyle = C.road;
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    ctx.fillRect(outer.x, outer.y, outer.w, outer.h);
  });

  carriages.forEach(car => {
    const work = car.zones[3];
    const hatch = strip(alongOf(work.start), alongOf(work.end), car.closed0, car.closed1);
    fillHatch(ctx, hatch.x, hatch.y, hatch.w, hatch.h);
    ctx.strokeStyle = '#4a4a4a';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(hatch.x, hatch.y, hatch.w, hatch.h);
    const hatchLabel = xy((alongOf(work.start) + alongOf(work.end)) / 2, car.closedMid);
    ctx.fillStyle = '#333';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('封闭', hatchLabel.x, hatchLabel.y);
  });

  carriages.forEach(car => {
    const dash = xy(alongStart, car.laneLine);
    const dash2 = xy(alongEnd, car.laneLine);
    ctx.strokeStyle = C.mark;
    ctx.lineWidth = 2;
    ctx.setLineDash([13, 11]);
    ctx.lineCap = 'round';
    line(ctx, dash.x, dash.y, dash2.x, dash2.y);
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  });

  ctx.strokeStyle = '#B5B5B5';
  ctx.lineWidth = 1;
  const leftEdge = xy(alongStart, 0);
  const leftEnd = xy(alongEnd, 0);
  const rightEdge = xy(alongStart, roadW);
  const rightEnd = xy(alongEnd, roadW);
  const midA = xy(alongStart, MEDIAN);
  const midB = xy(alongEnd, MEDIAN);
  line(ctx, leftEdge.x, leftEdge.y, leftEnd.x, leftEnd.y);
  line(ctx, rightEdge.x, rightEdge.y, rightEnd.x, rightEnd.y);
  line(ctx, midA.x, midA.y, midB.x, midB.y);

  cones.forEach(cone => {
    const p = xy(cone.along, cone.across);
    ctx.beginPath();
    ctx.fillStyle = C.cone;
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  });

  arrows.forEach(item => {
    const tip = xy(item.along + item.travel * 11, item.across);
    const left = xy(item.along - item.travel * 8, item.across - 6);
    const right = xy(item.along - item.travel * 8, item.across + 6);
    ctx.fillStyle = C.mark;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();
  });

  carriages.forEach(car => {
    const label = car.dir === 'up' ? '上行' : '下行';
    const p = xy(alongAt(car.zones, 0, car.zones[0].length * 0.08), car.openMid);
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x, p.y);
  });

  const medianCenter = xy(totalAlong / 2, (median0 + median1) / 2);
  ctx.fillStyle = C.muted;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  '中央分隔带'.split('').forEach((ch, i) => {
    ctx.fillText(ch, medianCenter.x, medianCenter.y - 40 + i * 16);
  });

  allSigns.forEach(item => {
    const postAcross = item.onRoad
      ? onRoadPostAcross(item.carriage, item)
      : shoulderPostAcross(item.carriage, item.side);
    const post = xy(item.along, postAcross);
    const signAt = xy(
      item.signAlong != null ? item.signAlong : item.along,
      signColumnAcross(item.carriage, item.side, item.shift || 0),
    );
    ctx.fillStyle = C.post;
    ctx.fillRect(post.x - 6, post.y - 2.5, 12, 5);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    line(ctx, post.x, post.y, signAt.x, signAt.y);
    drawSignFace(ctx, signAt.x, signAt.y, item.type, SIGN_SIZE, opts.signImages);
    if (item.label) {
      const labelOnOuter = signOnLeft(item.carriage, item.side);
      ctx.fillStyle = '#3a3a3c';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(
        item.label,
        signAt.x,
        signAt.y + (labelOnOuter ? -SIGN_SIZE / 2 - 4 : SIGN_SIZE / 2 + 12),
      );
    }
  });

  const dimAcross0 = roadW + SIGN_COL + 76;
  const dimTick = 26;
  zones.forEach(zone => {
    const a0 = Math.min(alongOf(zone.start), alongOf(zone.end));
    const a1 = Math.max(alongOf(zone.start), alongOf(zone.end));
    const mid = (a0 + a1) / 2;
    const start = xy(a0, dimAcross0);
    const end = xy(a1, dimAcross0);
    const tick0 = xy(a0, dimAcross0 - dimTick);
    const tick1 = xy(a0, dimAcross0 + dimTick);
    const tick2 = xy(a1, dimAcross0 - dimTick);
    const tick3 = xy(a1, dimAcross0 + dimTick);
    const label = xy(mid, dimAcross0 + dimTick + 20);
    ctx.strokeStyle = C.dim;
    ctx.fillStyle = C.dim;
    ctx.lineWidth = 1;
    line(ctx, start.x, start.y, end.x, end.y);
    line(ctx, tick0.x, tick0.y, tick1.x, tick1.y);
    line(ctx, tick2.x, tick2.y, tick3.x, tick3.y);
    ctx.font = '700 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ZONE_LETTER[zone.key] || '', label.x, label.y - 10);
    ctx.font = '500 9px sans-serif';
    ctx.fillStyle = '#3a3a3c';
    ctx.fillText(zone.name, label.x, label.y + 3);
    ctx.fillStyle = C.muted;
    ctx.font = '9px sans-serif';
    ctx.fillText(`${zone.length.toLocaleString()}m`, label.x, label.y + 15);
  });

  const seen = {};
  zones.forEach(zone => {
    [zone.start, zone.end].forEach(meters => {
      const along = alongOf(meters);
      const key = Math.round(along);
      if (seen[key]) return;
      seen[key] = true;
      const beside = xy(along, dimAcross0 - dimTick - 4);
      ctx.fillStyle = C.muted;
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'end';
      ctx.textBaseline = 'middle';
      ctx.fillText(stake(meters), beside.x, beside.y);
    });
  });

  return { viewW, viewH };
}

/** 单侧一张；双侧拆成上行/下行两张（带总平面）。 */
function laneSpecs(opts) {
  const { zones, direction, workSide, doubleSide, coneGap, speed, zoom } = opts;
  if (!doubleSide) {
    return [{
      key: 'main',
      title: '',
      zones,
      direction,
      workSide,
      coneGap,
      speed,
      zoom,
    }];
  }
  const mirrored = mirrorZones(zones, direction);
  const upZones = direction === 'up' ? zones : mirrored;
  const downZones = direction === 'down' ? zones : mirrored;
  const overview = { up: upZones, down: downZones };
  return [
    {
      key: 'up',
      title: '上行布置',
      zones: upZones,
      direction: 'up',
      workSide: 'median',
      coneGap,
      speed,
      zoom,
      crossSectionFocus: 'up',
      overview,
    },
    {
      key: 'down',
      title: '下行布置',
      zones: downZones,
      direction: 'down',
      workSide: 'median',
      coneGap,
      speed,
      zoom,
      crossSectionFocus: 'down',
      overview,
    },
  ];
}

/* ── 表格 ────────────────────────────────────────────── */

function scaleColumns(weights, width) {
  const sum = weights.reduce((acc, value) => acc + value, 0);
  const cols = weights.map(weight => Math.floor((width * weight) / sum * 10) / 10);
  cols[cols.length - 1] += width - cols.reduce((acc, value) => acc + value, 0);
  return cols;
}

function drawTable(ctx, cfg) {
  let {
    x, y, width, title, headers, rows, columnWidths,
    titleHeight = 32, rowHeight = 28, headerHeight = 30,
    fontSize, titleFontSize, height,
  } = cfg;

  if (height && height > 0 && rows.length > 0) {
    const base = titleHeight + headerHeight + rows.length * rowHeight;
    const scale = height / base;
    const cap = Math.min(Math.max(scale, 0.9), 1.45);
    titleHeight = Math.round(titleHeight * cap);
    headerHeight = Math.round(headerHeight * cap);
    rowHeight = (height - titleHeight - headerHeight) / rows.length;
  }

  const fs = fontSize != null ? fontSize : Math.max(11, Math.min(14.5, rowHeight * 0.36));
  const tfs = titleFontSize != null ? titleFontSize : Math.max(13, Math.min(16, titleHeight * 0.42));
  const offsets = columnWidths.reduce((list, value) => {
    list.push((list[list.length - 1] || 0) + value);
    return list;
  }, [0]);
  const tableH = titleHeight + headerHeight + rows.length * rowHeight;

  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, width, tableH);
  ctx.fillStyle = '#eef1f4';
  ctx.fillRect(x, y, width, titleHeight);
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(x, y + titleHeight, width, headerHeight);
  rows.forEach((_, index) => {
    if (index % 2 === 1) {
      ctx.fillStyle = '#f7f7f8';
      ctx.fillRect(x, y + titleHeight + headerHeight + index * rowHeight, width, rowHeight);
    }
  });

  ctx.strokeStyle = '#1d1d1f';
  ctx.lineWidth = 0.7;
  line(ctx, x, y + titleHeight, x + width, y + titleHeight);
  offsets.slice(1, -1).forEach(offset => {
    line(ctx, x + offset, y + titleHeight, x + offset, y + tableH);
  });
  for (let i = 0; i <= rows.length; i++) {
    const yy = y + titleHeight + headerHeight + i * rowHeight;
    line(ctx, x, yy, x + width, yy);
  }
  ctx.lineWidth = 1.1;
  ctx.strokeRect(x, y, width, tableH);

  ctx.fillStyle = '#1d1d1f';
  ctx.font = `700 ${tfs}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, x + 12, y + cellBaseline(titleHeight, tfs));

  ctx.fillStyle = '#3a3a3c';
  ctx.font = `700 ${fs}px sans-serif`;
  ctx.textAlign = 'center';
  headers.forEach((cell, i) => {
    ctx.fillText(cell, x + offsets[i] + columnWidths[i] / 2, y + titleHeight + cellBaseline(headerHeight, fs));
  });

  ctx.fillStyle = '#1d1d1f';
  ctx.font = `400 ${fs}px sans-serif`;
  rows.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      ctx.fillText(
        String(cell),
        x + offsets[ci] + columnWidths[ci] / 2,
        y + titleHeight + headerHeight + ri * rowHeight + cellBaseline(rowHeight, fs),
      );
    });
  });
}

/* ── A4 纵向分页 ────────────────────────────────────── */

function pageMetrics() {
  const inner = 22;
  const titleH = 68;
  const footerH = 38;
  const pad = 12;
  return {
    pageW: A4.w,
    pageH: A4.h,
    inner,
    titleH,
    footerH,
    contentX: inner + pad,
    contentY: inner + titleH + pad,
    contentW: A4.w - (inner + pad) * 2,
    contentH: A4.h - inner - titleH - pad - footerH - inner - 6,
  };
}

function drawChrome(ctx, title, subtitle, pageNo, pageCount) {
  const m = pageMetrics();
  const { pageW, pageH, inner, titleH, footerH } = m;
  const outer = 16;
  const footerY = pageH - inner - footerH;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pageW, pageH);
  ctx.strokeStyle = '#1d1d1f';
  ctx.lineWidth = 1.8;
  ctx.strokeRect(outer, outer, pageW - outer * 2, pageH - outer * 2);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(inner, inner, pageW - inner * 2, pageH - inner * 2);
  line(ctx, inner, inner + titleH, pageW - inner, inner + titleH);
  line(ctx, inner, footerY, pageW - inner, footerY);

  ctx.fillStyle = '#1d1d1f';
  ctx.font = '700 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, inner + 14, inner + 26);

  ctx.fillStyle = '#4a4a4f';
  ctx.font = '10px sans-serif';
  subtitle.split('\n').forEach((text, index) => {
    ctx.fillText(text, inner + 14, inner + 44 + index * 14);
  });

  ctx.fillStyle = '#6e6e73';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'end';
  ctx.fillText(`图 ${pageNo}　共 ${pageCount} 页`, pageW - inner - 12, inner + 28);

  ctx.font = '8.5px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('锥桶数量仅表示布置走向，现场按设定的 1-4m 间距放样。', inner + 12, footerY + 16);
  ctx.fillText('正式实施前，请依据道路等级、设计速度、施工类型及当地现行规范复核。', inner + 12, footerY + 28);
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'end';
  ctx.fillText('A4 纵向 · 比例示意', pageW - inner - 12, footerY + 22);
  return m;
}

function exportModel(opts) {
  const { params, zones, signRows, total, doubleSide } = opts;
  const primaryDir = params.direction === 'down' ? '下行' : '上行';
  const mirrorDir = primaryDir === '上行' ? '下行' : '上行';
  const mirrored = doubleSide ? mirrorZones(zones, params.direction) : null;
  const extent = zoneExtent(zones, mirrored || undefined);
  const lengthSummary = doubleSide
    ? `单侧长度：${total}m　整体影响：${stake(extent.min)}—${stake(extent.max)}（${extent.span}m）`
    : `布置总长度：${total}m`;
  const zoneRows = mirrored
    ? zones.map((zone, index) => [
        String(index + 1), zone.name, `${zone.length}m`,
        stake(zone.start), stake(zone.end),
        stake(mirrored[index].start), stake(mirrored[index].end),
      ])
    : zones.map((zone, index) => [String(index + 1), zone.name, `${zone.length}m`, stake(zone.start), stake(zone.end)]);
  const primaryItems = signRowsOf(zones, params.speed);
  const mirrorItems = mirrored ? signRowsOf(mirrored, params.speed) : null;
  const exportSignRows = mirrored
    ? primaryItems.map((item, index) => [
        String(index + 1), item[0], stake(item[1]), stake(mirrorItems[index][1]), item[2],
      ])
    : signRows.map(row => [String(row[0]), row[1], row[2], row[3]]);
  const subtitle = `作业区起点：${params.start}　方向：${doubleSide ? '上/下行' : primaryDir}　施工位置：${params.workSide === 'median' ? '中央分隔带' : '路侧'}${doubleSide ? '（双侧占路）' : ''}\n${lengthSummary}`;
  return { primaryDir, mirrorDir, mirrored, zoneRows, exportSignRows, subtitle };
}

function drawA4DiagramPage(ctx, opts) {
  const { spec, model, pageNo, pageCount } = opts;
  const title = spec.title
    ? `高速公路作业区布置图（${spec.title.replace('布置', '')}）`
    : '高速公路作业区布置图';
  const m = drawChrome(ctx, title, model.subtitle, pageNo, pageCount);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(m.contentX, m.contentY, m.contentW, m.contentH);

  const layout = diagramLayout({ zones: spec.zones, zoom: 1, overview: Boolean(spec.overview) });
  const scale = Math.min(m.contentW / layout.viewW, m.contentH / layout.viewH);
  const dx = m.contentX + (m.contentW - layout.viewW * scale) / 2;
  const dy = m.contentY + (m.contentH - layout.viewH * scale) / 2;
  ctx.save();
  ctx.translate(dx, dy);
  ctx.scale(scale, scale);
  drawRoadDiagram(ctx, spec);
  ctx.restore();
}

function drawA4TablePage(ctx, opts) {
  const { model, pageNo, pageCount } = opts;
  const m = drawChrome(ctx, '高速公路作业区一览表', model.subtitle, pageNo, pageCount);
  const zoneHeaders = model.mirrored
    ? ['序号', '分区名称', '长度', `${model.primaryDir}起点`, `${model.primaryDir}终点`, `${model.mirrorDir}起点`, `${model.mirrorDir}终点`]
    : ['序号', '分区名称', '长度', '起点桩号', '终点桩号'];
  const signHeaders = model.mirrored
    ? ['序号', '标志牌名称', `${model.primaryDir}桩号`, `${model.mirrorDir}桩号`, '位置说明']
    : ['序号', '标志牌名称', '设置桩号', '位置说明'];
  const zoneWeights = model.mirrored ? [40, 90, 56, 86, 86, 86, 86] : [48, 140, 80, 180, 180];
  const signWeights = model.mirrored ? [40, 160, 90, 90, 180] : [48, 220, 140, 240];
  const gap = 16;
  const zoneWeight = model.zoneRows.length + 2.4;
  const signWeight = model.exportSignRows.length + 2.4;
  const zoneH = (m.contentH - gap) * zoneWeight / (zoneWeight + signWeight);
  const signH = m.contentH - gap - zoneH;
  drawTable(ctx, {
    x: m.contentX, y: m.contentY, width: m.contentW, height: zoneH,
    title: '表 1　各区域起止点',
    headers: zoneHeaders,
    rows: model.zoneRows,
    columnWidths: scaleColumns(zoneWeights, m.contentW),
  });
  drawTable(ctx, {
    x: m.contentX, y: m.contentY + zoneH + gap, width: m.contentW, height: signH,
    title: '表 2　各标志牌位置',
    headers: signHeaders,
    rows: model.exportSignRows,
    columnWidths: scaleColumns(signWeights, m.contentW),
  });
}

const A4_PX = { w: 2480, h: 3508 };

module.exports = {
  A4,
  A4_PX,
  diagramLayout,
  laneSpecs,
  drawRoadDiagram,
  drawA4DiagramPage,
  drawA4TablePage,
  exportModel,
};
