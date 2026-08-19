const { defaults, validate, parseStake, stake } = require('../../utils/calc');

/** 数字字段转 Number（input 输出字符串） */
function normalize(p) {
  const out = Object.assign({}, p);
  ['work', 'warning', 'taper', 'buffer', 'downstream', 'terminal', 'speed', 'coneGap'].forEach(k => {
    out[k] = Number(out[k]);
  });
  out.warning = 1600;
  out.doubleSide = !!out.doubleSide;
  return out;
}

function endStakeOf(p) {
  const start = parseStake(p.start);
  const work = Number(p.work);
  if (start == null || !Number.isFinite(work) || work < 10) return '';
  return stake(start + (p.direction === 'down' ? -work : work));
}

Page({
  data: {
    p: Object.assign({}, defaults),
    errors: {},
    showAdvanced: false,
    endStake: endStakeOf(defaults),
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    const p = Object.assign({}, this.data.p);
    p[key] = value;
    const errors = Object.assign({}, this.data.errors);
    delete errors[key];
    this.setData({ p, errors, endStake: endStakeOf(p) });
  },

  onDirection(e) {
    const p = Object.assign({}, this.data.p, { direction: e.currentTarget.dataset.value });
    this.setData({ p, endStake: endStakeOf(p) });
  },

  onWorkSide(e) {
    const value = e.currentTarget.dataset.value;
    const p = Object.assign({}, this.data.p, {
      workSide: value,
      doubleSide: value === 'median' ? this.data.p.doubleSide : false,
    });
    this.setData({ p });
  },

  onDoubleSide(e) {
    const p = Object.assign({}, this.data.p, { doubleSide: e.currentTarget.dataset.value === 'true' });
    this.setData({ p });
  },

  onSpeed(e) {
    const p = Object.assign({}, this.data.p, { speed: Number(e.currentTarget.dataset.value) });
    const errors = Object.assign({}, this.data.errors);
    delete errors.speed;
    this.setData({ p, errors });
  },

  toggleAdvanced() {
    this.setData({ showAdvanced: !this.data.showAdvanced });
  },

  handleGenerate() {
    const p = normalize(this.data.p);
    const errors = validate(p);
    if (Object.keys(errors).length > 0) {
      this.setData({ errors });
      wx.showToast({ title: '请修正标红的参数', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'light', fail: () => {} });
    wx.setStorageSync('rz:params', p);
    wx.navigateTo({ url: '/pages/diagram/diagram' });
  },
});
