/**
 * 从 construction-hub/src/signs.ts 抽出官方标志牌 SVG，
 * 再栅格成小程序 canvas 可绘制的正方形 PNG。
 *
 * 微信小程序 image / canvas 不支持直接渲染 SVG，所以保留 SVG 源文件，
 * 运行时画的是同一套矢量稿的 PNG。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(path.resolve(ROOT, '../construction-hub/package.json'));
const sharp = require('sharp');
const SIGNS_TS = path.resolve(ROOT, '../construction-hub/src/signs.ts');
const SVG_DIR = path.join(ROOT, 'assets/signs/svg');
const PNG_DIR = path.join(ROOT, 'assets/signs');
const SIZE = 256;

const TITLE_TO_TYPE = {
  '右向导向': 'arrowRight',
  '左向导向': 'arrowLeft',
  '前方施工 1600 米': 'construction1600',
  '前方施工 800 米': 'construction800',
  '限速 80': 'limit80',
  '限速 60': 'limit60',
  '限速 40': 'limit40',
  '左侧车道并入右侧': 'laneLeft',
  '右侧车道并入左侧': 'laneRight',
  '解除限速 60': 'end60',
  '解除限速 40': 'end40',
  '禁止超车': 'noOvertake',
  '解除禁止超车': 'endOvertake',
  '作业区长度': 'length',
  '路栏': 'fence',
  '关闭智驾': 'smart',
};

function parseSigns(source) {
  const re = /title:\s*"([^"]+)",\s*svg:\s*"((?:\\.|[^"\\])*)"/g;
  const items = [];
  let match;
  while ((match = re.exec(source))) {
    items.push({ title: match[1], svg: JSON.parse(`"${match[2]}"`) });
  }
  return items;
}

function squareSvg(svg) {
  return svg
    .replace(/\swidth="[^"]*"/, ' width="256"')
    .replace(/\sheight="[^"]*"/, ' height="256"')
    .replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');
}

fs.mkdirSync(SVG_DIR, { recursive: true });
fs.mkdirSync(PNG_DIR, { recursive: true });

const items = parseSigns(fs.readFileSync(SIGNS_TS, 'utf8'));
if (items.length !== 16) {
  throw new Error(`expected 16 signs, got ${items.length}`);
}

for (const item of items) {
  const type = TITLE_TO_TYPE[item.title];
  if (!type) throw new Error(`unmapped sign title: ${item.title}`);
  const svg = squareSvg(item.svg);
  const svgPath = path.join(SVG_DIR, `${type}.svg`);
  const pngPath = path.join(PNG_DIR, `${type}.png`);
  fs.writeFileSync(svgPath, svg);
  await sharp(Buffer.from(svg), { density: 192 })
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(pngPath);
  const stat = fs.statSync(pngPath);
  console.log(`${type.padEnd(18)} ${stat.size} bytes`);
}
