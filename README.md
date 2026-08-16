# 路安作业区布置 · 微信小程序

高速公路作业区（施工区）交通安全设施布置的微信小程序客户端,与 Web 平台(施工管理平台)的作业区布置功能对应,但**独立运行、独立发布**,不依赖平台后端。

## 功能

- **参数输入页**(pages/index):起点桩号、作业区长度、方向(上行/下行)、施工位置(路侧/中央分隔带)、分区长度、锥桶间距等
- **布置图页**(pages/diagram):SVG 绘制各分区、锥桶、标志牌、桩号标注,可缩放
- **计算逻辑**(utils/calc.js):与 Web 端 `src/zone/utils.ts` 同一套分区计算(含上游过渡区/缓冲区整百米联合对齐),CommonJS 移植版
- **绘制引擎**(utils/draw.js):SVG 道路布置图绘制
- **标志牌时刻表**(utils/schedule.js)

## 目录

```
pages/index/       参数输入页
pages/diagram/     布置图页
utils/             calc 计算 / draw 绘制 / schedule 时刻表
app.js / app.json  小程序入口与配置
project.config.json  开发者工具配置（appid: wx3fb83afad5922409）
```

## 使用

微信开发者工具 → 导入项目 → 选择本文件夹（AppID 已配置）。

## 说明

- 代码为原生小程序（CommonJS + WXML/WXSS），与 Web 平台 React 代码相互独立,改动互不影响
- 若 Web 端作业区计算逻辑更新(如 `src/zone/utils.ts`),需要同步移植到 `utils/calc.js`
