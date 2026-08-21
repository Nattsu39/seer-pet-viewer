import { Texture, type TextureSource } from "pixi.js";
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

/** releaseAtlasLayoutPixels 需要的最小渲染器能力（WebGL 的 GlTextureSystem 提供） */
export interface AtlasUploader {
  texture: {
    initSource?: (source: TextureSource) => void;
  };
}

/**
 * 先把每个 tile 同步上传到 GPU，再关闭 CPU 侧 ImageBitmap。
 * 8192 图集因此不再 CPU/GPU 各驻留一份（省下约 256 MiB）。
 *
 * 代价：图集像素只存在于 GPU，放弃 WebGL context-loss 自动恢复；
 * 之后 remount 必须先用 `ensureSwfClipAtlas()` 从 bundle 恢复图集，
 * 因此仅在调用方仍持有 bundle buffer 时启用。
 *
 * 渲染器无法强制上传时（例如 WebGPU/Canvas 后端）返回 false 且不释放任何像素。
 */
export function releaseAtlasLayoutPixels(
  renderer: AtlasUploader,
  layout: SwfAtlasLayout | null,
): boolean {
  if (!layout) return false;
  const initSource = renderer.texture?.initSource;
  if (typeof initSource !== "function") return false;

  for (const entry of layout.tiles) {
    // 上传后 CPU 像素即失效：GC 卸载纹理会导致之后重新上传空图
    entry.texture.source.autoGarbageCollect = false;
    initSource.call(renderer.texture, entry.texture.source);
  }
  // 全部上传成功后才关闭，避免中途异常留下半释放的 layout
  for (const entry of layout.tiles) {
    if (entry.bitmap.width > 0 && entry.bitmap.height > 0) {
      entry.bitmap.close();
    }
  }
  return true;
}
