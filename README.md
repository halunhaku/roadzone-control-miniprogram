# 路安作业区布置 · 微信小程序

高速公路作业区（施工区）交通安全设施布置的微信小程序客户端，与 Web 平台（construction-hub）的布控图对齐，但**独立运行、独立发布**，不依赖平台后端。

## 功能

- **参数输入页**(pages/index)：起点桩号、作业区长度、方向、施工位置、过渡区/缓冲区基准、设计速度（80/100）
- **布置图页**(pages/diagram)：纵向规程图式（JTG H30，行车方向自下而上），双侧占路拆成上行/下行两张并带总平面缩略图
- **计算逻辑**(utils/calc.js)：与 Web 端 `src/zone/utils.ts` 同一套分区计算（用户输入长度，不做整百米对齐）
- **绘制引擎**(utils/draw.js)：纵向布置图 + A4 纵向分页导出（单侧：布置图 + 一览表；双侧：上行图 + 下行图 + 一览表）
- **官方标志牌**(assets/signs)：与 Web 端同一套 JTG 图例 SVG，栅格为 PNG 后画到 canvas（微信不支持直接渲染 SVG）
- **标志牌时刻表**(utils/schedule.js)：按设计速度切换逐级限速（100→80/60，80→60/40）

## 目录

```
pages/index/       参数输入页
pages/diagram/     布置图页
utils/             calc 计算 / draw 绘制 / schedule 时刻表
tests/             计算、时刻表与导出模型的 node:test
app.js / app.json  小程序入口与配置
project.config.json  开发者工具配置（appid: wx3fb83afad5922409）
```

## 使用

微信开发者工具 → 导入项目 → 选择本文件夹（AppID 已配置）。

验证计算与导出模型：

```bash
node --test tests/zone.test.js
```

若 Web 端 `src/signs.ts` 更新，重新生成标志牌资源：

```bash
node scripts/rasterize-signs.mjs
```

## 说明

- 代码为原生小程序（CommonJS + WXML/WXSS），与 Web 平台 React 代码相互独立，改动互不影响
- 若 Web 端作业区计算或布控图更新（`src/zone/utils.ts`、`src/zone/RoadDiagram.tsx`、`src/zone/export.ts`），需要同步移植
