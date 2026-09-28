export interface Point {
  x: number;
  y: number;
}
export interface Material {
  name: string;
  floats: Record<string, number>;
}
export interface Frame {
  labels: string[];
  vertices: Point[];
  uvs: number[];
  addColors: number[];
  mulColors: number[];
  subMeshes: { startVertex: number; indexCount: number; material: Material }[];
}
export interface Sequence {
  name: string;
  frames: Frame[];
}
export interface Clip {
  frameRate: number;
  pixelsPerUnit: number;
  atlas: { width: number; height: number; rgba: Uint8Array };
  sequences: Sequence[];
}
export type TextureScale = 1 | 0.5 | 0.25;

export interface RebuildOptions {
  /** 是否生成独立的动作预览，默认为 true。 */
  includePreviews?: boolean;
  /** 新生成位图的缩放比例，默认为 1；几何尺寸保持不变。 */
  textureScale?: TextureScale;
}

export interface RebuildReport {
  petSpriteId: number;
  sourceSha256: string;
  outputSha256: string;
  bitmapCount: number;
  textureScale: TextureScale;
  /** 新生成位图未压缩时的字节数，不包括保留的源位图。 */
  bitmapPixelBytes: number;
  /** 相同生成区域在原始分辨率下的字节数。 */
  originalBitmapPixelBytes: number;
  maskShapeCount: number;
  maskPlacements: number;
  frameRate: number;
  /** frames 和 hitFrame 指 bundle 中的动画内容；若存在嵌套播放，则由 contentSpriteId 标识。 */
  actions: {
    name: string;
    spriteId: number;
    contentSpriteId?: number;
    frames: number;
    hitFrame?: number;
    maskFrames: number;
  }[];
  warnings: string[];
}
