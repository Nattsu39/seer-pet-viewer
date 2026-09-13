# @seer-pet-anim/anim-export

将捕获的动画帧序列导出为 GIF / WebP / PNG 序列:提供参考缩放导出、紧裁剪(tight crop)、战斗视口规划与 alpha 边界计算等帧处理工具,编码在 Web Worker 内完成,不阻塞主线程。

## 安装

```bash
pnpm add @seer-pet-anim/anim-export
```

## 用法

```ts
import { exportAnimation, exportPngSequence } from "@seer-pet-anim/anim-export";
```

子路径导出:

- `@seer-pet-anim/anim-export/capture` —— 主线程侧的帧裁剪/缩放规划工具(不含编码器);
- `@seer-pet-anim/anim-export/texture-alignment` —— 纹理错位检测诊断工具。

## 说明

- WebP 编码由 [wasm-webp](https://www.npmjs.com/package/wasm-webp) 提供,其 wasm 随该 npm 依赖分发,无需额外配置;
- GIF 编码为纯 JS([gifenc](https://www.npmjs.com/package/gifenc));
- 布局常量来自 [@seer-pet-anim/battle-layout](../battle-layout)。

> 本库面向《赛尔号》游戏资产,不附带任何游戏素材,仅用于处理你自己合法获得的资源文件。

## License

MIT
