const { defaults, buildZones, stake, mirrorZones, zoneExtent } = require('../../utils/calc');
const { signSchedule, signScheduleDouble } = require('../../utils/schedule');
const {
  diagramLayout,
  laneSpecs,
  drawRoadDiagram,
  drawA4DiagramPage,
  drawA4TablePage,
  exportModel,
  A4,
  A4_PX,
} = require('../../utils/draw');
const { loadSignImages } = require('../../utils/signs');

function canvasIdOf(index) {
  return `road-${index}`;
}

Page({
  data: {
    zoomPct: 100,
    lanes: [],
    summary: [],
    legend: [],
    tableZones: [],
    tableSigns: [],
    tip: '',
  },

  onLoad() {
    this.params = wx.getStorageSync('rz:params') || Object.assign({}, defaults);
    this.params.doubleSide = !!this.params.doubleSide;
    this.params.warning = 1600;
    if (this.params.speed !== 80 && this.params.speed !== 100) this.params.speed = 100;
    this.zoom = 1;
    this.exporting = false;
    this.signImages = null;
    this.signImagesPromise = null;
    this.zones = buildZones(this.params);
    this.signRows = this.params.doubleSide
      ? signScheduleDouble(this.zones, this.params.direction, this.params.speed)
      : signSchedule(this.zones, this.params.direction, this.params.speed);

    const { zones, params } = this;
    const direction = params.direction;
    const total = zones.reduce((s, z) => s + z.length, 0);
    const dirText = direction === 'up' ? '上行' : '下行';
    const sideText = params.workSide === 'median' ? '中央分隔带' : '路侧';
    const primaryDir = dirText;
    const mirrorDir = primaryDir === '上行' ? '下行' : '上行';
    const mirrored = params.doubleSide ? mirrorZones(zones, direction) : null;
    const extent = zoneExtent(zones, mirrored || undefined);

    const mergedZones = params.doubleSide
      ? [
          ...zones.map(z => ({ z, dir: primaryDir })),
          ...mirrored.map(z => ({ z, dir: mirrorDir })),
        ]
      : zones.map(z => ({ z, dir: '' }));

    this.setData({
      summary: [
        { k: '作业区范围', v: `${stake(zones[3].start)} ~ ${stake(zones[3].end)}` },
        { k: '过渡区/缓冲区', v: `${zones[1].length}m / ${zones[2].length}m` },
        { k: params.doubleSide ? '单侧长度' : '布置总长度', v: `${total}m` },
        { k: '影响路段', v: `${stake(extent.min)} ~ ${stake(extent.max)}` },
        { k: '方向', v: params.doubleSide ? '上/下行' : dirText },
        { k: '施工位置', v: params.doubleSide ? `${sideText}（双侧占路）` : sideText },
        { k: '设计速度', v: `${params.speed} km/h` },
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
      tip: params.doubleSide
        ? '导出为 A4 纵向图纸：上行图、下行图、一览表共三页。每张布置图角落带双侧总平面缩略图。图中锥桶数量仅表示布置走向。'
        : '导出为 A4 纵向图纸：布置图 + 一览表。图面按《公路养护安全作业规程》JTG H30—2015 示意。图中锥桶数量仅表示布置走向。',
    });
  },

  onReady() {
    this.fitWidth = this.measureFitWidth();
    this.render();
  },

  measureFitWidth() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const pad = (24 * 2 * info.windowWidth) / 750;
    return Math.max(240, info.windowWidth - pad - 4);
  },

  specs() {
    return laneSpecs({
      zones: this.zones,
      direction: this.params.direction,
      workSide: this.params.workSide,
      doubleSide: this.params.doubleSide,
      coneGap: this.params.coneGap,
      speed: this.params.speed,
      zoom: 1,
    });
  },

  render() {
    if (this.exporting) return;
    const specs = this.specs();
    const lanes = specs.map((spec, index) => {
      const layout = diagramLayout({ zones: spec.zones, zoom: 1, overview: Boolean(spec.overview) });
      const scale = (this.fitWidth / layout.viewW) * this.zoom;
      return {
        key: spec.key,
        title: spec.title,
        canvasId: canvasIdOf(index),
        cssW: Math.round(layout.viewW * scale),
        cssH: Math.round(layout.viewH * scale),
      };
    });
    this.setData({ lanes, zoomPct: Math.round(this.zoom * 100) }, () => {
      wx.nextTick(() => {
        this.drawAll();
        // wx:for 生成的 type=2d canvas 偶发下一帧才挂 node
        setTimeout(() => { if (!this.exporting) this.drawAll(); }, 60);
      });
    });
  },

  drawAll() {
    if (this.exporting) return;
    const specs = this.specs();
    specs.forEach((spec, index) => this.drawLane(spec, canvasIdOf(index), index === 0));
  },

  ensureSignImages(canvas) {
    if (this.signImages) return Promise.resolve(this.signImages);
    if (!this.signImagesPromise) {
      this.signImagesPromise = loadSignImages(canvas).then(images => {
        this.signImages = images;
        return images;
      });
    }
    return this.signImagesPromise;
  },

  drawLane(spec, canvasId, keepNode) {
    wx.createSelectorQuery()
      .in(this)
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec(res => {
        if (this.exporting) return;
        if (!res || !res[0] || !res[0].node) return;
        const info = res[0];
        const canvas = info.node;
        this.ensureSignImages(canvas).then(images => {
          if (this.exporting) return;
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
          canvas.width = Math.round(info.width * dpr);
          canvas.height = Math.round(info.height * dpr);
          if (keepNode) this.canvasNode = canvas;
          const ctx = canvas.getContext('2d');
          const layout = diagramLayout({ zones: spec.zones, zoom: 1, overview: Boolean(spec.overview) });
          ctx.setTransform(canvas.width / layout.viewW, 0, 0, canvas.width / layout.viewW, 0, 0);
          drawRoadDiagram(ctx, Object.assign({}, spec, { signImages: images }));
        });
      });
  },

  zoomIn() {
    if (this.exporting) return;
    this.zoom = Math.min(1.5, this.zoom + 0.05);
    this.render();
  },

  zoomOut() {
    if (this.exporting) return;
    this.zoom = Math.max(0.65, this.zoom - 0.05);
    this.render();
  },

  zoomReset() {
    if (this.exporting) return;
    this.zoom = 1;
    this.render();
  },

  onZoomSliding(e) {
    this.zoom = e.detail.value / 100;
    this.setData({ zoomPct: e.detail.value });
  },

  onZoomSlider(e) {
    this.zoom = e.detail.value / 100;
    this.render();
  },

  saveView() {
    if (this.exporting) return;
    const lanes = this.data.lanes || [];
    if (lanes.length === 0) return;
    const files = [];
    const grab = index => {
      if (index >= lanes.length) {
        this.saveFiles(files);
        return;
      }
      wx.createSelectorQuery()
        .in(this)
        .select(`#${lanes[index].canvasId}`)
        .fields({ node: true, size: true })
        .exec(res => {
          if (!res || !res[0] || !res[0].node) {
            wx.showToast({ title: '生成图片失败', icon: 'none' });
            return;
          }
          wx.canvasToTempFilePath({
            canvas: res[0].node,
            success: file => {
              files.push(file.tempFilePath);
              grab(index + 1);
            },
            fail: () => wx.showToast({ title: '生成图片失败', icon: 'none' }),
          });
        });
    };
    grab(0);
  },

  exportA4() {
    if (this.exporting) return;
    const firstId = (this.data.lanes[0] && this.data.lanes[0].canvasId) || 'road-0';
    wx.createSelectorQuery()
      .in(this)
      .select(`#${firstId}`)
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) {
          wx.showToast({ title: '画布未就绪', icon: 'none' });
          return;
        }
        this.canvasNode = res[0].node;
        this.ensureSignImages(res[0].node).then(() => this.startExport(res[0].node));
      });
  },

  startExport(canvas) {
    this.exporting = true;
    const specs = this.specs();
    const total = this.zones.reduce((s, z) => s + z.length, 0);
    const model = exportModel({
      params: this.params,
      zones: this.zones,
      signRows: this.signRows,
      total,
      doubleSide: this.params.doubleSide,
    });
    const pages = [
      ...specs.map((spec, index) => ({ kind: 'diagram', spec, pageNo: index + 1 })),
      { kind: 'table', pageNo: specs.length + 1 },
    ];
    const pageCount = pages.length;
    wx.showLoading({ title: `生成图纸 1/${pageCount}` });
    const files = [];
    const drawPage = index => {
      if (index >= pages.length) {
        wx.hideLoading();
        this.exporting = false;
        this.render();
        this.saveFiles(files);
        return;
      }
      const page = pages[index];
      wx.showLoading({ title: `生成图纸 ${index + 1}/${pageCount}` });
      canvas.width = A4_PX.w;
      canvas.height = A4_PX.h;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(A4_PX.w / A4.w, 0, 0, A4_PX.w / A4.w, 0, 0);
      if (page.kind === 'diagram') {
        drawA4DiagramPage(ctx, {
          spec: Object.assign({}, page.spec, { signImages: this.signImages }),
          model,
          pageNo: page.pageNo,
          pageCount,
        });
      } else {
        drawA4TablePage(ctx, { model, pageNo: page.pageNo, pageCount });
      }
      wx.canvasToTempFilePath({
        canvas,
        success: res => {
          files.push(res.tempFilePath);
          drawPage(index + 1);
        },
        fail: () => {
          wx.hideLoading();
          this.exporting = false;
          this.render();
          wx.showToast({ title: '生成图片失败', icon: 'none' });
        },
      });
    };

    try {
      drawPage(0);
    } catch (err) {
      wx.hideLoading();
      this.exporting = false;
      this.render();
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
  },

  saveFiles(files) {
    const next = index => {
      if (index >= files.length) {
        wx.vibrateShort({ type: 'light', fail: () => {} });
        wx.showToast({
          title: files.length > 1 ? `已保存 ${files.length} 页到相册` : '已保存到相册',
          icon: 'success',
        });
        return;
      }
      this.saveToAlbum(files[index], () => next(index + 1), index === 0);
    };
    next(0);
  },

  saveToAlbum(filePath, onDone, silentFail) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        if (onDone) onDone();
        else {
          wx.vibrateShort({ type: 'light', fail: () => {} });
          wx.showToast({ title: '已保存到相册', icon: 'success' });
        }
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
          return;
        }
        if (!silentFail && !onDone) wx.showToast({ title: '保存失败', icon: 'none' });
        if (onDone) onDone();
      },
    });
  },
});
