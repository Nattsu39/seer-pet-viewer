# @seer-pet-anim/swf-bundle

解析赛尔号 Unity SWF 动画 bundle(`ppets_*`),提取 SwfClip 数据、网格与图集材质。基于 [@arkntools/unity-js](https://www.npmjs.com/package/@arkntools/unity-js) 进行 Unity 序列化文件解析。

## 安装

```bash
pnpm add @seer-pet-anim/swf-bundle
```

## 用法

Worker 解析(浏览器推荐,大 bundle 不阻塞主线程):

```ts
import { parseBundleInWorker } from "@seer-pet-anim/swf-bundle";
```

主线程解析(Node / 无 Worker 环境):

```ts
import { parseBundleCore } from "@seer-pet-anim/swf-bundle/parse";
```

## 说明

- 期望 bundle 内含游戏客户端自定义的 Unity 序列化类 `SwfClipAsset`;
- 内置共享材质 bundle 文件名常量 `SHARED_SWF_MATERIAL_BUNDLE_NAME`(赛尔号 PetAnimPackage 约定);
- 渲染请配合 [@seer-pet-anim/swf-renderer](../swf-renderer)。

> 本库面向《赛尔号》游戏资产,不附带任何游戏素材,仅用于处理你自己合法获得的资源文件。

## License

MIT
