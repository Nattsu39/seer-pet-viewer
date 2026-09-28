import { Buffer } from "buffer";
import {
  bitmap,
  bitmapShape,
  maskShape,
  sprite,
  browserCompression,
  type PixelRectangle,
  type Tag,
} from "./swf.js";
import type { Clip, TextureScale } from "./types.js";

export interface Region {
  id: number;
  width: number;
  height: number;
}

/** 合并多行中相同的水平区段，同时保留透明空洞。 */
export function alphaRectangles(
  width: number,
  height: number,
  rgba: Uint8Array,
): PixelRectangle[] {
  if (rgba.length !== width * height * 4)
    throw new Error("Mask pixel length mismatch");
  const rectangles: PixelRectangle[] = [];
  let previous = new Map<string, PixelRectangle>();
  for (let y = 0; y < height; y++) {
    const current = new Map<string, PixelRectangle>();
    let x = 0;
    while (x < width) {
      // Unity 使用 clip(alpha - 0.01)；alpha 为整数且在 0 到 2 之间时会被裁掉。
      if (rgba[(y * width + x) * 4 + 3] < 3) {
        x++;
        continue;
      }
      const start = x;
      while (x < width && rgba[(y * width + x) * 4 + 3] >= 3) x++;
      const key = `${start}:${x}`;
      const existing = previous.get(key);
      const rectangle = existing ?? {
        x: start,
        y,
        width: x - start,
        height: 0,
      };
      if (!existing) rectangles.push(rectangle);
      rectangle.height++;
      current.set(key, rectangle);
    }
    previous = current;
  }
  return rectangles;
}

export class ResourceDictionary {
  readonly tags: Tag[] = [];
  readonly regions = new Map<string, Region>();
  readonly masks = new Map<string, Region>();
  bitmapPixelBytes = 0;
  originalBitmapPixelBytes = 0;

  constructor(
    private readonly atlas: Clip["atlas"],
    private nextId: number,
    private readonly textureScale: TextureScale = 1,
    private readonly compression = browserCompression,
  ) {}

  private allocate(): number {
    if (this.nextId > 65535)
      throw new Error("SWF character dictionary exhausted");
    return this.nextId++;
  }

  createSprite(frames: Tag[][]): Tag {
    return sprite(this.allocate(), frames);
  }

  private crop(
    first: number,
    second: number,
  ): { width: number; height: number; pixels: Buffer } {
    const { width: atlasWidth, height: atlasHeight, rgba } = this.atlas;
    const x0 = Math.round(((first >>> 16) / 65535) * atlasWidth);
    const y0 = Math.round(((first & 65535) / 65535) * atlasHeight);
    const x1 = Math.round(((second >>> 16) / 65535) * atlasWidth);
    const y1 = Math.round(((second & 65535) / 65535) * atlasHeight);
    if (
      x0 < 0 ||
      y0 < 0 ||
      x1 > atlasWidth ||
      y1 > atlasHeight ||
      x1 <= x0 ||
      y1 <= y0
    ) {
      throw new Error(`Invalid or reversed UV rectangle ${first}:${second}`);
    }
    const width = x1 - x0;
    const height = y1 - y0;
    const pixels = Buffer.alloc(width * height * 4);
    for (let row = 0; row < height; row++) {
      const offset = ((y0 + row) * atlasWidth + x0) * 4;
      pixels.set(rgba.subarray(offset, offset + width * 4), row * width * 4);
    }
    return { width, height, pixels };
  }

  region(first: number, second: number): Region {
    const key = `${first}:${second}`;
    const cached = this.regions.get(key);
    if (cached) return cached;
    const { width, height, pixels } = this.crop(first, second);
    const bitmapId = this.allocate();
    const bitmapWidth = Math.ceil(width * this.textureScale);
    const bitmapHeight = Math.ceil(height * this.textureScale);
    // 放置变换和遮罩几何仍使用原始区域尺寸。
    const region = { id: this.allocate(), width, height };
    this.tags.push(
      bitmap(
        bitmapId,
        width,
        height,
        pixels,
        this.textureScale,
        this.compression,
      ),
      bitmapShape(
        region.id,
        bitmapId,
        width,
        height,
        bitmapWidth,
        bitmapHeight,
      ),
    );
    this.originalBitmapPixelBytes += width * height * 4;
    this.bitmapPixelBytes += bitmapWidth * bitmapHeight * 4;
    this.regions.set(key, region);
    return region;
  }

  mask(first: number, second: number): Region {
    const key = `${first}:${second}`;
    const cached = this.masks.get(key);
    if (cached) return cached;
    const { width, height, pixels } = this.crop(first, second);
    const region = { id: this.allocate(), width, height };
    this.tags.push(
      maskShape(
        region.id,
        width,
        height,
        alphaRectangles(width, height, pixels),
      ),
    );
    this.masks.set(key, region);
    return region;
  }
}
