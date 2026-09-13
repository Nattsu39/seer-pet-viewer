# @seer-pet-anim/battle-layout

赛尔号战斗场景布局计算库:16:9 战斗设计画布、宠物站位计算、相机/画布适配。布局常量逆向自游戏客户端(`BasePetAnimator` 锚点、`BattlePet*Animator` 缩放、`SWFPets` 容器与 spine 场景偏移)。

## 安装

```bash
pnpm add @seer-pet-anim/battle-layout
```

## 用法

```ts
import { computeBattlePetPlacement, fitBattleCanvas } from "@seer-pet-anim/battle-layout";
```

本包无运行时依赖,是 [@seer-pet-anim/anim-export](../anim-export) 的底层依赖。

## 说明

> 本库面向《赛尔号》游戏资产,不附带任何游戏素材,仅用于处理你自己合法获得的资源文件。

## License

MIT
