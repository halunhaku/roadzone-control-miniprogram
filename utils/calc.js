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
  start: 'K123+800', work: 1000, direction: 'up', workSide: 'roadside', doubleSide: false,
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

/* ── 双侧占路镜像 ────────────────────────────────────── */

/**
 * 生成对向车道的镜像分区：与主方向长度完全一致（上下游一致），
 * 以作业区终点为锚点反方向延伸，使两侧作业区桩号范围重合。
 * 主方向为上行时作业区 [start, start+work]，镜像锚点取作业区终点；
 * 主方向为下行时作业区 [start-work, start]，同样取终点（即低桩号端）。
 * 不对镜像侧做整百米对齐，保证两侧参数一致（180° 对称）。
 * @param {Array} zones buildZones 输出
 * @param {'up'|'down'} direction
 * @returns {Array} 与 zones 等长、桩号区间镜像的分区数组
 */
function mirrorZones(zones, direction) {
  const work = zones[3];
  const opposite = direction === 'up' ? 'down' : 'up';
  const anchor = work.end;
  const before = zones[0].length + zones[1].length + zones[2].length;
  let cursor = opposite === 'up' ? anchor - before : anchor + before;
  const sign = opposite === 'up' ? 1 : -1;
  return zones.map(z => {
    const a = cursor;
    const b = cursor + sign * z.length;
    cursor = b;
    return Object.assign({}, z, { start: a, end: b });
  });
}

/* ── XML 转义 ────────────────────────────────────────── */

function xmlText(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return String(value).replace(/[&<>"']/g, char => map[char]);
}

/* ── 输入校验 ────────────────────────────────────────── */

/** 返回字段 → 错误信息映射；无错误时为空对象 */
function validate(raw) {
  // 防御性归一：调用方（如 onInput）可能传入字符串值，这里统一转 Number，
  // 避免后续 `p.warning + 350` 这类算术退化为字符串拼接（"1600" + 350 → "1600350"）。
  // 空串 "" → 0，会命中下方 `< min` 校验；undefined/非法字符 → NaN，由 isFinite 拦截。
  const NUM_KEYS = ['work', 'warning', 'taper', 'buffer', 'downstream', 'terminal', 'speed', 'coneGap'];
  const p = Object.assign({}, raw);
  NUM_KEYS.forEach(k => { p[k] = Number(raw[k]); });

  const errors = {};
  // 数值字段必须为有限数
  [['work', '作业区长度'], ['warning', '警告区长度'], ['taper', '上游过渡区长度'],
    ['buffer', '缓冲区长度'], ['downstream', '下游过渡区长度'], ['terminal', '终止区长度'],
    ['speed', '设计速度'], ['coneGap', '锥桶间距']].forEach(pair => {
    const key = pair[0];
    const label = pair[1];
    if (!Number.isFinite(p[key])) errors[key] = `${label}必须是有效数字`;
  });

  const start = parseStake(p.start);
  if (!start) {
    errors.start = '桩号格式错误，示例：K123+800';
  } else if (p.direction === 'up' && start < p.warning + 350) {
    // 上行各分区桩号递减：警告区起点 = 锚点 − 警告区 − (过渡区+缓冲区)最大 350m。
    // 锚点不足会令警告区起点（首个「前方施工」标志牌）跌入 0+000 之前的负桩号。
    errors.start = `上行时起点桩号需 ≥ ${stake(p.warning + 350)}（警告区 + 上游区段上限），否则将出现负桩号`;
  } else if (p.direction === 'down' && start < p.work + p.warning + 350) {
    // 下行一律检查：作业区起点即锚点，需预留 = 作业区 + 警告区 + 上游区段上限 350m，
    // 否则标志牌布置区间极值会越过 0+000（双侧占路时镜像上行侧、单侧时作业区起点附近同理）。
    errors.start = `下行时起点桩号需 ≥ ${stake(p.work + p.warning + 350)}，否则将在 0+000 之前布置标志`;
  }

  if (p.work < 10) errors.work = '作业区长度至少 10m';
  if (p.doubleSide && p.workSide !== 'median') errors.workSide = '双侧占路仅限中央分隔带施工';
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
  mirrorZones,
  xmlText,
  validate,
};
