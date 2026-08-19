/** 与 Web 端 src/signs.ts / RoadDiagram SIGN_BY_TYPE 一一对应。 */

const SIGN_TYPES = [
  'construction1600',
  'construction800',
  'length',
  'smart',
  'limit80',
  'limit60',
  'limit40',
  'laneLeft',
  'laneRight',
  'noOvertake',
  'arrowLeft',
  'arrowRight',
  'end60',
  'end40',
  'endOvertake',
  'fence',
];

const SIGN_SRC = {};
SIGN_TYPES.forEach(type => {
  SIGN_SRC[type] = `/assets/signs/${type}.png`;
});

/**
 * 用 canvas 2d 的 createImage 预加载官方标志牌。
 * 小程序不支持直接画 SVG，这里加载的是同一套矢量稿栅格出的 PNG。
 */
function loadSignImages(canvas) {
  if (!canvas || typeof canvas.createImage !== 'function') {
    return Promise.resolve({});
  }
  return Promise.all(SIGN_TYPES.map(type => new Promise(resolve => {
    const img = canvas.createImage();
    img.onload = () => resolve([type, img]);
    img.onerror = () => resolve([type, null]);
    img.src = SIGN_SRC[type];
  }))).then(pairs => {
    const images = {};
    pairs.forEach(pair => {
      if (pair[1]) images[pair[0]] = pair[1];
    });
    return images;
  });
}

module.exports = { SIGN_TYPES, SIGN_SRC, loadSignImages };
