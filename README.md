# 赛尔号 Unity 精灵动画在线查看器

在浏览器中查看赛尔号 Unity 端精灵的待机、出招等动画（`ppets_*` AssetBundle）。

## 技术栈

- mise + pnpm + TypeScript + Vue 3 + Vite
- PixiJS（WebGL 渲染）
- UnityPy（开发期分析，可选 CLI 预转换）

## 快速开始

```bash
mise install
pnpm install
pnpm dev
```

## 示例文件

将 `ppets_*` bundle 拖入查看器，或使用 `examples/` 目录中的样本。

## CLI 预转换

```bash
pnpm export examples/ppets_70
```

生成 `.swfclip` 目录（`meta.json` + `atlas.png`），可在查看器中快速加载。

## 部署

```bash
pnpm build
# 输出在 apps/viewer/dist，可部署到 GitHub Pages / Cloudflare Pages
```
