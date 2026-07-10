import { Texture } from "pixi.js";
import {
  planAtlasTileGrid,
  splitAtlasBitmap,
  type AtlasTileDesc,
  type AtlasTilePlan,
} from "@seer/swf-bundle";

export interface AtlasTileRuntime {
  tile: AtlasTileDesc;
  bitmap: ImageBitmap;
  texture: Texture;
}

export interface SwfAtlasLayout {
  plan: AtlasTilePlan | null;
  tiles: AtlasTileRuntime[];
  /** 为 true 时表示 tile bitmap 由 layout 创建，destroy 时需释放 */
  split: boolean;
}

export async function prepareAtlasTiles(
  atlas: ImageBitmap,
  logicalWidth: number,
  logicalHeight: number,
  maxTileSize: number,
): Promise<SwfAtlasLayout> {
  const plan = planAtlasTileGrid(logicalWidth, logicalHeight, maxTileSize);
  if (!plan) {
    const texture = Texture.from(atlas);
    texture.source.scaleMode = "nearest";
    texture.source.alphaMode = "no-premultiply-alpha";
    return {
      plan: null,
      split: false,
      tiles: [
        {
          tile: {
            index: 0,
            col: 0,
            row: 0,
            x: 0,
            y: 0,
            width: logicalWidth,
            height: logicalHeight,
          },
          bitmap: atlas,
          texture,
        },
      ],
    };
  }

  const bitmaps = await splitAtlasBitmap(atlas, plan);
  const tiles = plan.tiles.map((tile, i) => {
    const bitmap = bitmaps[i]!;
    const texture = Texture.from(bitmap);
    texture.source.scaleMode = "nearest";
    texture.source.alphaMode = "no-premultiply-alpha";
    return { tile, bitmap, texture };
  });

  return { plan, split: true, tiles };
}

export function destroyAtlasLayout(layout: SwfAtlasLayout | null): void {
  if (!layout?.split) return;
  for (const entry of layout.tiles) {
    entry.bitmap.close();
    if (!entry.texture.destroyed) {
      entry.texture.destroy(true);
    }
  }
}
