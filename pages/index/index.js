const { defaults, validate } = require('../../utils/calc');

/** 数字字段转 Number（input 输出字符串） */
function normalize(p) {
  const out = Object.assign({}, p);
  ['work', 'warning', 'taper', 'buffer', 'downstream', 'terminal', 'speed', 'coneGap'].forEach(k => {
    out[k] = Number(out[k]);
  });
  return out;
}

Page({
  data: {
    p: Object.assign({}, defaults),
    errors: {},
    showAdvanced: true,
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    const p = Object.assign({}, this.data.p);
    p[key] = value;
    // 输入时清除该字段错误，实时反馈
    const errors = Object.assign({}, this.data.errors);
    delete errors[key];
    this.setData({ p, errors });
  },

  onDirection(e) {
    const p = Object.assign({}, this.data.p, { direction: e.currentTarget.dataset.value });
    this.setData({ p });
  },

  onWorkSide(e) {
    const value = e.currentTarget.dataset.value;
    // 双侧占路仅中央分隔带施工可选：切回路侧时复位
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
    // 触感与视觉同帧：校验通过立即轻震
    wx.vibrateShort({ type: 'light', fail: () => {} });
    wx.setStorageSync('rz:params', p);
    wx.navigateTo({ url: '/pages/diagram/diagram' });
  },
});
