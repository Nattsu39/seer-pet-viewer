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

export interface PrepareAtlasTilesOptions {
  /** 分块成功后 close() 原始图集，避免大图与 tile 副本双倍驻留 */
  releaseSource?: boolean;
}

export async function prepareAtlasTiles(
  atlas: ImageBitmap,
  logicalWidth: number,
  logicalHeight: number,
  maxTileSize: number,
  options: PrepareAtlasTilesOptions = {},
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
  if (options.releaseSource) {
    atlas.close();
  }
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
  if (!layout) return;
  for (const entry of layout.tiles) {
    if (layout.split) {
      if (entry.bitmap.width > 0 && entry.bitmap.height > 0) {
        entry.bitmap.close();
      }
    }
    if (!entry.texture.destroyed) {
      entry.texture.destroy(true);
    }
  }
}
