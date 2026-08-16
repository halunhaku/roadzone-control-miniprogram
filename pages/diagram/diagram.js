const { defaults, buildZones, stake, mirrorZones } = require('../../utils/calc');
const { signSchedule, signScheduleDouble } = require('../../utils/schedule');
const { drawDiagram, drawA4Sheet, svgWidthFor, VIEW_H } = require('../../utils/draw');

Page({
  data: {
    zoomPct: 100,
    canvasW: 1240,
    canvasH: 430,
    summary: [],
    legend: [],
    tableZones: [],
    tableSigns: [],
  },

  onLoad() {
    this.params = wx.getStorageSync('rz:params') || Object.assign({}, defaults);
    // 旧版本存储的参数没有 doubleSide 字段，统一归一为布尔
    this.params.doubleSide = !!this.params.doubleSide;
    this.zoom = 1;
    this.zones = buildZones(this.params);
    this.signRows = this.params.doubleSide
      ? signScheduleDouble(this.zones, this.params.direction)
      : signSchedule(this.zones, this.params.direction);

    const { zones, params } = this;
    const direction = params.direction;
    const total = zones.reduce((s, z) => s + z.length, 0);
    const dirText = direction === 'up' ? '上行' : '下行';
    const sideText = params.workSide === 'median' ? '中央分隔带' : '路侧';
    const primaryDir = dirText;
    const mirrorDir = primaryDir === '上行' ? '下行' : '上行';
    const mirrored = params.doubleSide ? mirrorZones(zones, direction) : null;

    // 双侧占路：分区表两车道合并（方向前缀），序号连续
    const mergedZones = params.doubleSide
      ? [
          ...zones.map(z => ({ z, dir: primaryDir })),
          ...mirrored.map(z => ({ z, dir: mirrorDir })),
        ]
      : zones.map(z => ({ z, dir: '' }));

    // 影响路段取全部车道（含镜像侧）的桩号极值
    const allZones = params.doubleSide ? zones.concat(mirrored) : zones;
    let minStake = Infinity;
    let maxStake = -Infinity;
    allZones.forEach(z => {
      minStake = Math.min(minStake, z.start, z.end);
      maxStake = Math.max(maxStake, z.start, z.end);
    });

    this.setData({
      summary: [
        { k: '作业区范围', v: `${stake(zones[3].start)} ~ ${stake(zones[3].end)}` },
        { k: '过渡区/缓冲区实际长度', v: `${zones[1].length}m / ${zones[2].length}m` },
        { k: '布置总长度', v: `${total}m` },
        { k: '影响路段', v: `${stake(minStake)} ~ ${stake(maxStake)}` },
        { k: '方向', v: params.doubleSide ? '上/下行' : dirText },
        { k: '施工位置', v: params.doubleSide ? `${sideText}（双侧占路）` : sideText },
      ],
      legend: zones.map(z => ({ key: z.key, color: z.color, name: z.name })),
      tableZones: mergedZones.map((row, i) => ({
        key: `${row.dir}-${row.z.key}`,
        no: i + 1,
        dir: row.dir,
        name: row.z.name,
        color: row.z.color,
        length: `${row.z.length}m`,
        start: stake(row.z.start),
        end: stake(row.z.end),
      })),
      tableSigns: this.signRows.map(r => ({ no: r[0], name: r[1], stake: r[2], desc: r[3] })),
    });
  },

  onReady() {
    this.render();
  },

  /* ── canvas 渲染 ── */

  render() {
    const svgWidth = svgWidthFor(this.zones, this.params.direction, this.params.doubleSide);
    const cssW = Math.round(svgWidth * this.zoom);
    const cssH = Math.round(VIEW_H * this.zoom);
    this.setData({ canvasW: cssW, canvasH: cssH, zoomPct: Math.round(this.zoom * 100) }, () => {
      wx.nextTick(() => this.draw());
    });
  },

  draw() {
    wx.createSelectorQuery()
      .in(this)
      .select('#road')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) return;
        const info = res[0];
        const canvas = info.node;
        // 物理像素 = CSS 尺寸 × dpr；绘制按逻辑坐标（svgWidth × VIEW_H）
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
        canvas.width = Math.round(info.width * dpr);
        canvas.height = Math.round(info.height * dpr);
        this.canvasNode = canvas;
        const ctx = canvas.getContext('2d');
        const svgWidth = svgWidthFor(this.zones, this.params.direction, this.params.doubleSide);
        ctx.setTransform(canvas.width / svgWidth, 0, 0, canvas.width / svgWidth, 0, 0);
        drawDiagram(ctx, {
          zones: this.zones,
          direction: this.params.direction,
          workSide: this.params.workSide,
          coneGap: this.params.coneGap,
          doubleSide: this.params.doubleSide,
        });
      });
  },

  /* ── 缩放 ── */

  zoomIn() {
    this.zoom = Math.min(1.5, this.zoom + 0.05);
    this.render();
  },

  zoomOut() {
    this.zoom = Math.max(0.65, this.zoom - 0.05);
    this.render();
  },

  zoomReset() {
    this.zoom = 1;
    this.render();
  },

  onZoomSlider(e) {
    this.zoom = e.detail.value / 100;
    this.render();
  },

  /* ── 导出 ── */

  saveView() {
    if (!this.canvasNode) return;
    wx.canvasToTempFilePath({
      canvas: this.canvasNode,
      success: res => this.saveToAlbum(res.tempFilePath),
      fail: () => wx.showToast({ title: '生成图片失败', icon: 'none' }),
    });
  },

  /**
   * 导出完整 A4 图纸（300dpi 3508×2480）：
   * 复用页面主 canvas，临时把物理分辨率改为 A4 尺寸绘制，导出后恢复。
   * （无隐藏 canvas / 离屏 canvas 的真机兼容性问题）
   */
  exportA4() {
    if (!this.canvasNode) return;
    wx.showLoading({ title: '生成图纸…' });
    const W = 3508;
    const H = 2480;
    const canvas = this.canvasNode;
    const total = this.zones.reduce((s, z) => s + z.length, 0);

    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(W / 1123, 0, 0, W / 1123, 0, 0);

    const done = () => this.render();
    try {
      drawA4Sheet(ctx, {
        zones: this.zones,
        direction: this.params.direction,
        workSide: this.params.workSide,
        coneGap: this.params.coneGap,
        start: this.params.start,
        total,
        signRows: this.signRows,
        doubleSide: this.params.doubleSide,
      });
      wx.canvasToTempFilePath({
        canvas,
        success: res => {
          wx.hideLoading();
          done();
          this.saveToAlbum(res.tempFilePath);
        },
        fail: () => {
          wx.hideLoading();
          done();
          wx.showToast({ title: '生成图片失败', icon: 'none' });
        },
      });
    } catch {
      wx.hideLoading();
      done();
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        // 保存完成：触感与视觉反馈同帧（harmony）
        wx.vibrateShort({ type: 'light', fail: () => {} });
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: err => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0 || msg.indexOf('cancel') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册',
            confirmText: '去设置',
            success: r => {
              if (r.confirm) wx.openSetting();
            },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },
});
