# @seer-pet-anim/spine-bundle

解析赛尔号 Unity Spine bundle(`spines_*` / `pskilltimeline_*`),提取 Spine 骨架 JSON、图集与动画序列。基于 [@arkntools/unity-js](https://www.npmjs.com/package/@arkntools/unity-js) 进行 Unity 序列化文件解析。

## 安装

```bash
pnpm add @seer-pet-anim/spine-bundle
```

## 用法

Worker 解析(浏览器推荐):

```ts
import { parseSpineBundleInWorker } from "@seer-pet-anim/spine-bundle";
```

主线程解析(Node / 无 Worker 环境):

```ts
import { parseSpineBundleCore } from "@seer-pet-anim/spine-bundle/parse";
```

## 说明

- 内置赛尔号动画名到中文标签的映射 `SPINE_SEQUENCE_LABELS`(await/standby/attack 等);
- 渲染请配合 [@seer-pet-anim/spine-renderer](../spine-renderer)。

> 本库面向《赛尔号》游戏资产,不附带任何游戏素材,仅用于处理你自己合法获得的资源文件。

## License

MIT
