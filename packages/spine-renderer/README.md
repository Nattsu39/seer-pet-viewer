# @seer-pet-anim/spine-renderer

基于 [@esotericsoftware/spine-webgl](https://esotericsoftware.com/) 4.0 的赛尔号 Spine 宠物动画播放器:消费 [@seer-pet-anim/spine-bundle](../spine-bundle) 解析出的骨架与图集数据,在 WebGL 上渲染 Spine 动画。

## 安装

```bash
pnpm add @seer-pet-anim/spine-renderer
```

## 用法

```ts
import { SpinePlayer } from "@seer-pet-anim/spine-renderer";
```

支持帧捕获(配合 [@seer-pet-anim/anim-export](../anim-export) 导出 GIF / WebP / PNG 序列)。

## 说明

- 本包面向浏览器(bundler 环境),依赖 spine-webgl / spine-core 4.0;
- 解析层见 [@seer-pet-anim/spine-bundle](../spine-bundle)。

> 本库面向《赛尔号》游戏资产,不附带任何游戏素材,仅用于处理你自己合法获得的资源文件。

## License

MIT
