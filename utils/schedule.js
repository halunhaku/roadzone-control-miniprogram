/* ── 标志牌时刻表：与 Web 端 src/zone/export.ts 对齐 ── */

const { stake, warningSignOffsets, mirrorZones, speedLimits } = require('./calc');

function warningNames(speed) {
  const limits = speedLimits(speed);
  return {
    0: '前方施工 1600m', 400: '关闭智驾', 600: `限速 ${limits.first}`, 800: '前方施工 800m',
    1000: `限速 ${limits.final}`, 1200: '禁止超车 / 车道减少',
  };
}

const WARN_DESCS = {
  0: '0m / 警告区起点', 400: '距警告区起点 400m', 600: '距警告区起点 600m',
  800: '距警告区起点 800m', 1000: '距警告区起点 1000m', 1200: '距警告区起点 1200m',
};

/**
 * 标志项目：[名称, 桩号（数字）, 位置说明]。
 * 偏移超出警告区实际长度的标志不设置。
 * @param {Array} zones buildZones 的输出
 * @param {number} speed 设计速度
 * @returns {Array<[string, number, string]>}
 */
function signRowsOf(zones, speed) {
  const at = (zone, offset) => zone.start + Math.sign(zone.end - zone.start) * offset;
  const warnLen = zones[0].length;
  const names = warningNames(speed);
  const limits = speedLimits(speed);
  const items = [];
  warningSignOffsets
    .filter(offset => offset <= warnLen)
    .forEach(offset => items.push([names[offset], at(zones[0], offset), WARN_DESCS[offset]]));
  items.push(['导向标志牌', at(zones[1], 50), '过渡区内 50m']);
  items.push(['路栏 / 作业区长度', zones[2].start, '缓冲区入口']);
  items.push([`解除限速 ${limits.final} / 禁止超车`, zones[5].end, '终止区终点']);
  return items;
}

/**
 * 生成标志牌时刻表。
 * @param {Array} zones
 * @param {'up'|'down'} _direction
 * @param {number} speed
 * @returns {Array<[number, string, string, string]>}
 */
function signSchedule(zones, _direction, speed) {
  return signRowsOf(zones, speed).map((item, index) => [index + 1, item[0], stake(item[1]), item[2]]);
}

/**
 * 双侧占路：主方向 + 镜像对向车道的标志时刻表。
 * @param {Array} zones
 * @param {'up'|'down'} direction
 * @param {number} speed
 * @returns {Array<[number, string, string, string]>}
 */
function signScheduleDouble(zones, direction, speed) {
  const primaryDir = direction === 'down' ? '下行' : '上行';
  const mirrorDir = primaryDir === '上行' ? '下行' : '上行';
  const merged = [
    ...signSchedule(zones, direction, speed).map(r => [r[1], r[2], `${primaryDir} · ${r[3]}`]),
    ...signSchedule(mirrorZones(zones, direction), direction, speed).map(r => [r[1], r[2], `${mirrorDir} · ${r[3]}`]),
  ];
  return merged.map((r, i) => [i + 1, r[0], r[1], r[2]]);
}

module.exports = { signRowsOf, signSchedule, signScheduleDouble };
