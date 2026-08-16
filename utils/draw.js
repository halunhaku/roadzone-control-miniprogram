/* ── Canvas 绘制层：从 Web 版 RoadDiagram.tsx / export.ts 逐行移植 ──
 *
 * 坐标体系与网页版 SVG viewBox 完全一致（逻辑坐标，单位 = 逻辑像素）：
 *   - 布置图：宽 = svgWidthFor()，高 = VIEW_H(430)
 *   - A4 图纸：逻辑 1123×794，调用方 setTransform(W/1123, …) 后绘制
 * 页面负责设置 ctx transform 与清屏；本模块不触碰 transform。
 */

const { stake, warningSignOffsets } = require('./calc');

/** 布置图逻辑高度（= 网页 SVG viewBox 高度） */
const VIEW_H = 430;

const SIGN_LABELS = {
  construction1600: '1600', construction800: '800', length: '长度', smart: '智驾',
  limit80: '80', limit60: '60', laneLeft: '减道', laneRight: '减道',
  noOvertake: '禁超', arrowLeft: '导向', arrowRight: '导向',
  end60: '解60', endOvertake: '解禁',
};

/* ── 工具 ────────────────────────────────────────────── */

function hexToRgba(hex, alpha) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** 表格单元格文字基线（与 exportTable 的 cellBaseline 一致） */
function cellBaseline(h, s) {
  return Math.round((h - s) / 2 + s * 0.82);
}

/** 布置图逻辑宽度（= 网页 svgWidth = max(1225, roadRight + 80)） */
function svgWidthFor(zones, _direction) {
  const total = zones.reduce((s, z) => s + z.length, 0);
  const widths = zones.map(z => Math.max(62, z.length / total * 1090));
  const roadRight = 68 + widths.reduce((s, w) => s + w, 0);
  return Math.max(1225, roadRight + 80);
}

/* ── 标志牌 ──────────────────────────────────────────── */

function drawSign(ctx, x, y, type) {
  const ended = type === 'end60' || type === 'endOvertake';
  const limit = type === 'limit80' || type === 'limit60';
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.fillStyle = ended ? '#f2f2f7' : '#fff';
  ctx.strokeStyle = ended ? '#8e8e93' : limit ? '#ff3b30' : '#ff9f0a';
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fillStyle = limit ? '#fff' : ended ? '#f2f2f7' : '#fff9f0';
  ctx.strokeStyle = '#e5e5ea';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1d1d1f';
  ctx.font = '800 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(SIGN_LABELS[type] || '标志', x, y + 3.5);
}

/* ── 布置图 ──────────────────────────────────────────── */

/**
 * 绘制高速公路作业区布置图（逻辑坐标，原点在左上角）。
 * @param {CanvasRenderingContext2D} ctx 已设置好 transform 的 2d 上下文
 * @param {Object} opts
 * @param {Array} opts.zones buildZones 输出
 * @param {'up'|'down'} opts.direction
 * @param {'roadside'|'median'} opts.workSide
 * @param {number} opts.coneGap 锥桶间距（米）
 */
function drawDiagram(ctx, opts) {
  const { zones, direction, workSide, coneGap } = opts;
  const total = zones.reduce((s, z) => s + z.length, 0);
  const left = 68;
  const width = 1090;
  // 色块最小宽度 62px：保证 5 字 × 9px 字号 + 框边距在任何参数下都能完整放下
  const widths = zones.map(z => Math.max(62, z.length / total * width));
  const roadRight = left + widths.reduce((s, w) => s + w, 0);
  const upper = direction === 'up';

  let cursor = upper ? roadRight : left;
  const blocks = zones.map((z, i) => {
    const w = widths[i];
    const bx = upper ? cursor - w : cursor;
    cursor += upper ? -w : w;
    return Object.assign({}, z, { x: bx, w });
  });

  const svgWidth = Math.max(1225, roadRight + 80);

  const zoneY = upper ? (workSide === 'median' ? 133 : 80) : (workSide === 'median' ? 204 : 257);
  const zoneHeight = 53;
  const roadsideGuardrailY = upper ? 80 : 310;
  const medianGuardrailY = upper ? 186 : 204;
  const guardrailY = workSide === 'median' ? medianGuardrailY : roadsideGuardrailY;
  const workBoundaryY = upper ? 133 : 257;
  const signY = workSide === 'median' ? medianGuardrailY : roadsideGuardrailY;
  const oppositeSignY = workSide === 'median' ? roadsideGuardrailY : medianGuardrailY;

  const along = (b, t) => b.x + (upper ? 1 - t : t) * b.w;
  const closedSide = Math.sign(zoneY + zoneHeight / 2 - workBoundaryY);
  // 锥桶贴近施工边界线（2px 微偏即可，视觉上贴线）
  const coneBoundaryY = workBoundaryY + closedSide * 2;

  /* 锥桶坐标（bi 1–4：过渡/缓冲/作业/下游过渡） */
  const cones = [];
  blocks.forEach((b, bi) => {
    if (bi < 1 || bi > 4) return;
    // 锥桶密度随锥桶间距参数变化；coneGap=4 时每个锥桶间距 24px
    const spacing = 24 * (coneGap / 4);
    const count = Math.max(3, Math.min(30, Math.round(b.w / Math.max(1, spacing))));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const yy = bi === 1
        ? guardrailY + (coneBoundaryY - guardrailY) * t
        : bi === 4
          ? coneBoundaryY + (guardrailY - coneBoundaryY) * t
          : coneBoundaryY;
      cones.push({ x: along(b, t), y: yy });
    }
  });

  /* 警告区标志 */
  const warnLen = blocks[0].length;
  const warnTypes = {
    0: 'construction1600', 400: 'smart', 600: 'limit80', 800: 'construction800',
    1000: 'limit60', 1200: workSide === 'median' ? 'laneLeft' : 'laneRight',
  };
  const warningX = offset => (warnLen > 0 && offset <= warnLen ? along(blocks[0], offset / warnLen) : null);
  const wx0 = warningX(0);
  const wx1200 = warningX(1200);
  const warningSigns = warningSignOffsets
    .filter(offset => offset <= warnLen)
    .map(offset => ({ x: warningX(offset), type: warnTypes[offset] }));
  const terminalEnd = upper ? blocks[5].x : blocks[5].x + blocks[5].w;

  /* 标注坐标（与 RoadDiagram.tsx 常量一致） */
  const zoneBadgeY = upper ? 397 : 8;
  const zoneBadgeTextY = zoneBadgeY + 15;
  const dimensionY = upper ? 365 : 46;
  const dimensionTextY = upper ? 358 : 40;
  const stakeTextY = upper ? 385 : 58;
  const guideStartY = upper ? 110 : 38;
  const guideEndY = upper ? 352 : 310;

  /* ── 背景 ── */
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, svgWidth, VIEW_H);

  /* ── 双向路面 ── */
  ctx.fillStyle = '#3a3a3c';
  ctx.fillRect(30, 80, svgWidth - 30, 106);
  ctx.fillRect(30, 204, svgWidth - 30, 106);

  /* ── 中央分隔带 ── */
  ctx.fillStyle = '#8e8e93';
  ctx.fillRect(30, 186, svgWidth - 30, 18);
  ctx.strokeStyle = '#d1d1d6';
  ctx.lineWidth = 2;
  line(ctx, 30, 186, svgWidth, 186);
  line(ctx, 30, 204, svgWidth, 204);

  /* ── 中线虚线 ── */
  ctx.strokeStyle = '#aeaeb2';
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 8]);
  line(ctx, 30, 195, svgWidth, 195);
  ctx.setLineDash([]);

  /* ── 车道分隔虚线 ── */
  ctx.strokeStyle = '#f2f2f7';
  ctx.lineWidth = 2;
  ctx.setLineDash([20, 18]);
  ctx.globalAlpha = 0.8;
  line(ctx, 30, 133, svgWidth, 133);
  line(ctx, 30, 257, svgWidth, 257);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  /* ── 护栏（双线 + 竖条） ── */
  [80, 310].forEach(y => {
    ctx.strokeStyle = '#d1d1d6';
    ctx.lineWidth = 6;
    line(ctx, 30, y, svgWidth, y);
    ctx.strokeStyle = '#8e8e93';
    ctx.lineWidth = 2;
    line(ctx, 30, y, svgWidth, y);
    for (let i = 0; i < 36; i++) {
      const x = 45 + i * 36;
      line(ctx, x, y - 5, x, y + 5);
    }
  });

  /* ── 分区（色块 / 引导线 / 尺寸线 / 标签 / 徽章） ── */
  blocks.forEach(b => {
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(b.x, zoneY, b.w, zoneHeight);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#c7c7cc';
    ctx.lineWidth = 1;
    line(ctx, b.x, guideStartY, b.x, guideEndY);

    ctx.strokeStyle = '#6e6e73';
    line(ctx, b.x, dimensionY, b.x + b.w, dimensionY);

    ctx.fillStyle = '#6e6e73';
    ctx.beginPath();
    ctx.moveTo(b.x, dimensionY);
    ctx.lineTo(b.x + 8, dimensionY - 4);
    ctx.lineTo(b.x + 8, dimensionY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(b.x + b.w, dimensionY);
    ctx.lineTo(b.x + b.w - 8, dimensionY - 4);
    ctx.lineTo(b.x + b.w - 8, dimensionY + 4);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a3a3c';
    ctx.font = '700 11px sans-serif';
    ctx.fillText(`${b.length}m`, b.x + b.w / 2, dimensionTextY);

    ctx.fillStyle = '#6e6e73';
    ctx.font = '10px sans-serif';
    ctx.fillText(stake(upper ? b.end : b.start), b.x, stakeTextY);

    // 分区徽章：框宽跟随文字，不超过分区色块宽
    const fontSize = 9;
    const textWidth = Array.from(b.name).length * fontSize;
    const badgeW = Math.max(38, Math.min(textWidth + 14, b.w - 2));
    const badgeX = b.x + b.w / 2 - badgeW / 2;
    ctx.fillStyle = hexToRgba(b.color, 0.13);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 1;
    roundRect(ctx, badgeX, zoneBadgeY, badgeW, 22, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillText(b.name, b.x + b.w / 2, zoneBadgeTextY);
  });

  /* ── 右端线 + 终点桩号 ── */
  ctx.strokeStyle = '#c7c7cc';
  ctx.lineWidth = 1;
  line(ctx, roadRight, guideStartY, roadRight, upper ? 391 : 66);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6e6e73';
  ctx.font = '10px sans-serif';
  ctx.fillText(stake(upper ? zones[0].start : zones[zones.length - 1].end), roadRight, stakeTextY);

  /* ── 锥桶 ── */
  cones.forEach(c => {
    ctx.beginPath();
    ctx.fillStyle = '#ff9500';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  /* ── 缓冲区入口：作业区长度标志 ── */
  drawSign(ctx, along(blocks[2], 0), signY, 'length');

  /* ── 行向标注 ── */
  ctx.fillStyle = '#fff';
  ctx.font = '700 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('上行 ←', 48, 137);
  ctx.fillText('下行 →', 48, 261);

  /* ── 警告区标志 + 对向标志 + 终止区标志 ── */
  warningSigns.forEach(s => drawSign(ctx, s.x, signY, s.type));
  if (wx1200 !== null) drawSign(ctx, wx1200, oppositeSignY, 'noOvertake');
  if (wx0 !== null) drawSign(ctx, wx0, oppositeSignY, 'construction1600');
  drawSign(ctx, terminalEnd, signY, 'end60');
  drawSign(ctx, terminalEnd, oppositeSignY, 'endOvertake');
}

/* ── 表格 ────────────────────────────────────────────── */

/**
 * 绘制明细表（exportTable 的 canvas 版，几何参数完全一致）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} cfg
 * @param {number} cfg.x @param {number} cfg.y @param {number} cfg.width
 * @param {string} cfg.title
 * @param {string[]} cfg.headers
 * @param {string[][]} cfg.rows
 * @param {number[]} cfg.columnWidths
 * @param {number} [cfg.titleHeight=28] @param {number} [cfg.rowHeight=28]
 * @param {number} [cfg.headerHeight=30] @param {number} [cfg.fontSize=10]
 * @param {number} [cfg.titleFontSize=12]
 */
function drawTable(ctx, cfg) {
  const {
    x, y, width, title, headers, rows, columnWidths,
    titleHeight = 28, rowHeight = 28, headerHeight = 30,
    fontSize = 10, titleFontSize = 12,
  } = cfg;

  const offsets = columnWidths.reduce((list, value, index) => {
    list.push((list[index] || 0) + value);
    return list;
  }, [0]);
  const height = titleHeight + headerHeight + rows.length * rowHeight;

  ctx.strokeStyle = '#d1d1d6';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#fff';
  roundRect(ctx, x, y, width, height, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#eaf2ff';
  roundRect(ctx, x, y, width, titleHeight, 4);
  ctx.fill();

  ctx.fillStyle = '#f5f5f7';
  ctx.fillRect(x, y + titleHeight, width, headerHeight);

  offsets.slice(1, -1).forEach(off => {
    line(ctx, x + off, y + titleHeight, x + off, y + height);
  });
  for (let i = 0; i <= rows.length; i++) {
    line(ctx, x, y + titleHeight + headerHeight + i * rowHeight, x + width, y + titleHeight + headerHeight + i * rowHeight);
  }

  ctx.fillStyle = '#007aff';
  ctx.font = `700 ${titleFontSize}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(title, x + 12, y + cellBaseline(titleHeight, titleFontSize));

  ctx.fillStyle = '#6e6e73';
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  headers.forEach((cell, i) => {
    ctx.fillText(cell, x + offsets[i] + columnWidths[i] / 2, y + titleHeight + cellBaseline(headerHeight, fontSize));
  });

  ctx.fillStyle = '#1d1d1f';
  ctx.font = `${fontSize}px sans-serif`;
  rows.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      ctx.fillText(cell, x + offsets[ci] + columnWidths[ci] / 2, y + titleHeight + headerHeight + ri * rowHeight + cellBaseline(rowHeight, fontSize));
    });
  });
}

/* ── A4 图纸（逻辑 1123×794，调用方负责 setTransform） ── */

/**
 * 绘制完整 A4 横向图纸：标题 + 布置图 + 两张明细表。
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} opts
 * @param {Array} opts.zones @param {'up'|'down'} opts.direction
 * @param {'roadside'|'median'} opts.workSide @param {number} opts.coneGap
 * @param {string} opts.start 起点桩号原文 @param {number} opts.total 布置总长度
 * @param {Array} opts.signRows signSchedule 输出
 */
function drawA4Sheet(ctx, opts) {
  const { zones, direction, workSide, coneGap, start, total, signRows } = opts;
  const dirText = direction === 'up' ? '上行' : '下行';
  const sideText = workSide === 'median' ? '中央分隔带' : '路侧';
  const svgWidth = svgWidthFor(zones, direction);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1123, 794);

  /* 标题条 */
  ctx.fillStyle = '#ff9f0a';
  ctx.fillRect(30, 21, 4, 17);
  ctx.fillStyle = '#1d1d1f';
  ctx.font = '700 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('高速公路作业区布置图', 40, 34);
  ctx.fillStyle = '#6e6e73';
  ctx.font = '10px sans-serif';
  ctx.fillText(`作业区起点：${start}　方向：${dirText}　施工位置：${sideText}　布置总长度：${total}m`, 40, 55);

  /* 图框 + 布置图嵌入 */
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#9fb0bf';
  ctx.lineWidth = 1;
  roundRect(ctx, 30, 68, 1063, 350, 5);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.translate(36, 74);
  ctx.scale(1051 / svgWidth, 1051 / svgWidth);
  drawDiagram(ctx, { zones, direction, workSide, coneGap });
  ctx.restore();

  /* 两张明细表 */
  const zoneRows = zones.map((z, i) => [String(i + 1), z.name, `${z.length}m`, stake(z.start), stake(z.end)]);
  drawTable(ctx, {
    x: 30, y: 438, width: 500,
    title: '1. 各区域起止点',
    headers: ['序号', '分区名称', '长度', '起点桩号', '终点桩号'],
    rows: zoneRows,
    columnWidths: [44, 116, 76, 132, 132],
  });

  const signRows2 = signRows.map(r => [String(r[0]), r[1], r[2], r[3]]);
  drawTable(ctx, {
    x: 548, y: 438, width: 545,
    title: '2. 各标志牌位置',
    headers: ['序号', '标志牌名称', '设置桩号', '位置说明'],
    rows: signRows2,
    columnWidths: [44, 190, 112, 199],
  });
}

module.exports = { VIEW_H, svgWidthFor, drawDiagram, drawTable, drawA4Sheet };
