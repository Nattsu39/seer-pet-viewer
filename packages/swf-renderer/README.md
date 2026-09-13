# @seer-pet-anim/swf-renderer

基于 [PixiJS](https://pixijs.com/) v8 的赛尔号 SWF 宠物动画播放器:消费 [@seer-pet-anim/swf-bundle](../swf-bundle) 解析出的 clip 数据,以网格 + 图集材质在 WebGL/WebGPU 上渲染动画帧。

## 安装

```bash
pnpm add @seer-pet-anim/swf-renderer
```

## 用法

```ts
import { SwfPlayer } from "@seer-pet-anim/swf-renderer";
```

支持帧捕获(配合 [@seer-pet-anim/anim-export](../anim-export) 导出 GIF / WebP / PNG 序列)。

## 说明

- 本包面向浏览器(bundler 环境),依赖 pixi.js;
- 解析层见 [@seer-pet-anim/swf-bundle](../swf-bundle)。

> 本库面向《赛尔号》游戏资产,不附带任何游戏素材,仅用于处理你自己合法获得的资源文件。

## License

MIT
