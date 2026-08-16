/* ── 计算逻辑：从 Web 版 src/utils.ts 原样移植，零 DOM 依赖 ── */

/* ── 常量 ────────────────────────────────────────────── */

/** 分区元信息（颜色与网页版一致） */
const zoneMeta = [
  { key: 'warning', name: '警告区', color: '#FF9F0A', description: '按0/400/600/800/1000/1200m设置标志，区域内不摆锥桶' },
  { key: 'taper', name: '上游过渡区', color: '#0A84FF', description: '锥桶斜向渐变导流；50m处设置导向箭头' },
  { key: 'buffer', name: '缓冲区', color: '#5AC8FA', description: '入口设置路栏及作业区长度标志，保留安全净空' },
  { key: 'work', name: '作业区', color: '#FF3B30', description: '沿封闭车道连续摆放锥桶，设备与人员在内作业' },
  { key: 'downstream', name: '下游过渡区', color: '#AF52DE', description: '锥桶斜向渐变撤除，引导车辆恢复行驶' },
  { key: 'terminal', name: '终止区', color: '#30D158', description: '终点设置解除限速60及解除禁止超车标志' },
];

/** 默认参数 */
const defaults = {
  start: 'K123+800', work: 1000, direction: 'up', workSide: 'roadside',
  warning: 1600, taper: 200, buffer: 150, downstream: 30, terminal: 30,
  speed: 100, coneGap: 4,
};

/** 警告区标志设置偏移（距警告区起点，米）；超出警告区实际长度的标志不设置 */
const warningSignOffsets = [0, 400, 600, 800, 1000, 1200];

/* ── 桩号工具 ────────────────────────────────────────── */

/** 解析桩号字符串（K123+800 / K123800 / 100+800 / 800 等变体），非法返回 null */
function parseStake(v) {
  const s = String(v).trim().replace(/＋/g, '+').replace(/\s+/g, '');
  // 带分隔符：K123+800 / 100+800 / K0+050
  const split = s.match(/^(?:K)?(\d+)\+(\d{1,3})$/i);
  if (split) return Number(split[1]) * 1000 + Number(split[2]);
  // 无分隔符：100800 / K100800 / 800（视为总米数）
  const plain = s.match(/^(?:K)?(\d+)$/i);
  return plain ? Number(plain[1]) : null;
}

/** 米数 → 桩号字符串（负值钳制为 K0+000） */
function stake(m) {
  const n = Math.max(0, Math.round(m));
  return `K${Math.floor(n / 1000)}+${String(n % 1000).padStart(3, '0')}`;
}

/* ── 上游过渡区与缓冲区联合对齐 ──────────────────────── */

/**
 * 在 120–200m / 100–150m 范围内联合调整，使外端对齐整百米桩号，
 * 并优先采用整十米长度。
 */
function alignedUpstreamZones(anchor, baseTaper, baseBuffer, direction) {
  let best = null;

  for (let taper = 120; taper <= 200; taper += 1) {
    for (let buffer = 100; buffer <= 150; buffer += 1) {
      const total = taper + buffer;
      const outerStake = direction === 'up' ? anchor - total : anchor + total;
      // 外端不能为负（负桩号无意义），且需对齐整百米
      if (outerStake < 0 || outerStake % 100 !== 0) continue;

      const taperRemainder = taper % 10;
      const bufferRemainder = buffer % 10;
      const candidate = {
        taper,
        buffer,
        totalDelta: Math.abs(total - (baseTaper + baseBuffer)),
        tenMeterPenalty:
          Math.min(taperRemainder, 10 - taperRemainder) +
          Math.min(bufferRemainder, 10 - bufferRemainder),
        individualDelta: (taper - baseTaper) ** 2 + (buffer - baseBuffer) ** 2,
      };
      if (
        !best ||
        candidate.totalDelta < best.totalDelta ||
        (candidate.totalDelta === best.totalDelta && candidate.tenMeterPenalty < best.tenMeterPenalty) ||
        (candidate.totalDelta === best.totalDelta &&
          candidate.tenMeterPenalty === best.tenMeterPenalty &&
          candidate.individualDelta < best.individualDelta)
      ) {
        best = candidate;
      }
    }
  }

  // 两个区间的合计范围为 220–350m，跨度超过 100m，锚点足够时必有整百米解。
  // 锚点过小（上行起点不足）时回退基准值，由 validate 负责拦截。
  if (!best) return { taper: baseTaper, buffer: baseBuffer };
  return { taper: best.taper, buffer: best.buffer };
}

/* ── 分区计算 ────────────────────────────────────────── */

/**
 * 按方向生成 6 个分区的桩号区间。
 * @param {Object} p Params
 * @returns {Array<{key:string,name:string,color:string,description:string,length:number,start:number,end:number}>}
 */
function buildZones(p) {
  const parsed = parseStake(p.start);
  const anchor = parsed !== null && parsed !== undefined ? parsed : 123800;
  const actual = alignedUpstreamZones(anchor, Number(p.taper), Number(p.buffer), p.direction);
  const lens = [p.warning, actual.taper, actual.buffer, p.work, p.downstream, p.terminal].map(Number);
  const before = lens[0] + lens[1] + lens[2];
  let cursor = p.direction === 'up' ? anchor - before : anchor + before;
  const sign = p.direction === 'up' ? 1 : -1;
  return zoneMeta.map((z, i) => {
    const a = cursor;
    const b = cursor + sign * lens[i];
    cursor = b;
    return Object.assign({}, z, { length: lens[i], start: a, end: b });
  });
}

/* ── XML 转义 ────────────────────────────────────────── */

function xmlText(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return String(value).replace(/[&<>"']/g, char => map[char]);
}

/* ── 输入校验 ────────────────────────────────────────── */

/** 返回字段 → 错误信息映射；无错误时为空对象 */
function validate(p) {
  const errors = {};
  const start = parseStake(p.start);
  if (!start) {
    errors.start = '桩号格式错误，示例：K123+800';
  } else if (p.direction === 'up' && start < p.warning + 350) {
    // 上行时各分区桩号递减，警告区起点 = 锚点 − 警告区 − (过渡区+缓冲区)最大 350m，
    // 锚点不足会出现负桩号，被 stake() 静默钳制为 K0+000。
    errors.start = `上行时起点桩号需 ≥ ${stake(p.warning + 350)}（警告区 + 上游区段上限），否则将出现负桩号`;
  }
  if (p.work < 10) errors.work = '作业区长度至少 10m';
  if (p.warning < 50) errors.warning = '警告区长度至少 50m';
  if (p.taper < 120 || p.taper > 200) errors.taper = '上游过渡区长度应为 120-200m';
  if (p.buffer < 100 || p.buffer > 150) errors.buffer = '缓冲区长度应为 100-150m';
  if (p.downstream < 10) errors.downstream = '下游过渡区长度至少 10m';
  if (p.terminal < 10) errors.terminal = '终止区长度至少 10m';
  if (p.coneGap < 1) errors.coneGap = '锥桶间距至少 1m';
  if (p.speed < 20 || p.speed > 120) errors.speed = '设计速度应在 20-120 km/h';
  return errors;
}

module.exports = {
  zoneMeta,
  defaults,
  warningSignOffsets,
  parseStake,
  stake,
  alignedUpstreamZones,
  buildZones,
  xmlText,
  validate,
};
