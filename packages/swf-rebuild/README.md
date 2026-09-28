# `@seer-pet-anim/swf-rebuild`

从 Unity 动画资源重建精灵 SWF 动画。该工具读取原始 SWF、对应的动画 bundle 和共享材质 bundle，生成可供 Flash 端使用的 SWF。

## 准备

- Node.js 23.5 或更新版本。
- 同一只精灵对应的原始 SWF 和 Unity 动画 bundle（通常名为 `ppets_<编号>.bundle`）。
- 该 bundle 所引用的 `shared-materials.bundle`。

工具会从文件内容识别动作和坐标，但不能证明 SWF 与两个 bundle 一定属于同一只精灵。请使用配套资源。当前只支持符合本工具预期结构的资源；不支持的结构会报错。

## 使用方式

### 预览器网页

单宠布局的控制栏提供「导出 SWF」按钮与缩放倍率输入框。导出当前完整 bundle 的动画，倍率支持 `1`、`0.5`、`0.25`，仅影响生成的贴图分辨率，保持动画坐标和尺寸。切换 bundle 时，文件超过 15 MB（15 × 1024 × 1024 字节）默认使用 `0.5`，其他文件默认使用 `1`，可以手动修改。

导出需要原始 bundle 和已加载的共享材质包，并按精灵编号从官网获取原始 SWF。Spine 动画与缺少原始 bundle 的预转换包禁用该控件；战斗布局不显示该控件。转换在独立 Worker 内执行，切换精灵或离开单宠布局会取消导出并释放 Worker。

浏览器集成入口为 `@seer-pet-anim/swf-rebuild/browser`，提供 `loadUnityClip` 和异步 `rebuildPet`。浏览器使用 fflate 压缩，Node 入口保留原有 zlib 输出；两者共用动画重建逻辑。只需要完整 SWF 时，可传入 `includePreviews: false`，省去单独的动作预览文件。

### 命令行

```sh
npx @seer-pet-anim/swf-rebuild@latest \
  --source path/to/pet.swf \
  --bundle path/to/ppets_1234.bundle \
  --materials path/to/shared-materials.bundle \
  --out out/pet-rebuilt.swf \
  --previews out/previews
```

Windows PowerShell 可将命令写在一行。`--previews` 可省略；查看所有参数可运行：

```sh
npx @seer-pet-anim/swf-rebuild@latest --help
```

测试过程中发现 Flash 端无法加载部分尺寸过高的动画资源，遇到这种情况时可尝试降低新生成贴图的分辨率：

```sh
npx @seer-pet-anim/swf-rebuild@latest --source path/to/pet.swf --bundle path/to/ppets_1234.bundle --materials path/to/shared-materials.bundle --out out/pet-rebuilt-half.swf --texture-scale 0.5
```

`--texture-scale` 可设为 `1`（默认）、`0.5` 或 `0.25`。它只缩小重建时新增的贴图，不改变动画帧和几何；较低分辨率会降低图像细节。

## 输出文件

- 指定的 `.swf`：重建后的动画，保留游戏使用的动作接口。
- `<输出文件>.swf.json`：处理报告，包含识别到的动作、帧数、贴图和遮罩统计，以及输入文件信息。
- `--previews` 目录中的 SWF（若指定）：每个动作一个无脚本循环预览，便于独立查看动作内容。

CLI 不会覆盖已有输出文件。再次运行时请指定新的 `.swf` 路径；报告文件和预览文件也不能与已有文件重名。

## 在代码中使用

```ts
import { readFile, writeFile } from "node:fs/promises";
import { loadUnityClip, rebuildPet } from "@seer-pet-anim/swf-rebuild";

const clip = await loadUnityClip(
  await readFile("ppets_1234.bundle"),
  await readFile("shared-materials.bundle"),
);
const result = rebuildPet(await readFile("pet.swf"), clip, {
  textureScale: 1,
});

await writeFile("pet-rebuilt.swf", result.swf, { flag: "wx" });
console.log(result.report.actions);
```

`loadUnityClip` 解析动画 bundle 和共享材质；`rebuildPet` 返回重建后的 `swf`、动作 `previews` 和 `report`。`textureScale` 是可选项，允许值与 CLI 相同。API 详情见 [`src/index.ts`](src/index.ts) 及导出的类型定义。

## 支持范围

当前工具针对特定格式的 FlashTools 精灵动画资源，不是通用 SWF 编辑器。SWF 与 bundle 的帧率必须一致；动画需要包含可识别的 `pet` 导出、待机序列和预期的动作包装结构。遇到不支持的材质、遮罩或时间轴结构时，转换会失败并说明原因。
