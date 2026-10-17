# @seer-pet-anim/anim-export

将捕获的动画帧序列导出为 GIF / WebP / MP4 / PNG 序列，提供参考布局、紧裁剪、战斗视口规划与 alpha 边界计算。GIF/WebP 使用编码 Worker，MP4 使用浏览器原生 H.264 编码。

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

### MP4

```ts
import { checkMp4Support, exportAnimation } from "@seer-pet-anim/anim-export";

const support = await checkMp4Support();
if (!support.supported) throw new Error(support.reason);

const controller = new AbortController();
const video = await exportAnimation(
  player,
  {
    format: "mp4",
    sequence: "standby",
    scale: 1,
    background: 0x1a1a2e,
    signal: controller.signal,
  },
  (progress) => {
    // prepare / mux have no frame count; render their stage label only.
    console.log(
      progress.phase,
      progress.total > 0 ? `${progress.done}/${progress.total}` : "",
    );
  },
);
// During export, controller.abort() cancels without returning an incomplete file.
```

## 说明

- WebP 编码由 [wasm-webp](https://www.npmjs.com/package/wasm-webp) 提供,其 wasm 随该 npm 依赖分发,无需额外配置;
- GIF 编码为纯 JS([gifenc](https://www.npmjs.com/package/gifenc));
- 布局常量来自 [@seer-pet-anim/battle-layout](../battle-layout)。

> 本库面向《赛尔号》游戏资产,不附带任何游戏素材,仅用于处理你自己合法获得的资源文件。

## License

MIT
