import type { SwfClipData } from "@seer/swf-bundle";
import { getEffectiveSwfMaxTextureSize } from "../lib/swf-texture";
import type { SwfPlayer } from "@seer/swf-renderer";

/** Harness 所需的播放器公开 API（避免 Vue UnwrapRef 剥离 class 私有字段） */
type SwfBaselinePlayer = Pick<
  SwfPlayer,
  | "getAtlasTileDebugInfo"
  | "setSequence"
  | "pause"
  | "gotoFrame"
  | "fitToView"
  | "getCanvas"
  | "captureFrames"
>;
import {
  detectTextureMisalignment,
  type RgbaImage,
  type TextureAlignmentOptions,
  type TextureAlignmentReport,
} from "@seer/anim-export/texture-alignment";

export const SWF_BASELINE_HARNESS_VERSION = 1;

export interface SwfBaselineExportFrame {
  index: number;
  width: number;
  height: number;
  sha256: string;
  nonZeroAlphaPixels: number;
}

export interface SwfBaselineEnvironment {
  harnessVersion: number;
  userAgent: string;
  devicePixelRatio: number;
  maxTextureSize: number;
  atlasLogical: { width: number; height: number };
  atlasBitmap: { width: number; height: number };
  atlasScaled: boolean;
  petId: number;
  frameRate: number;
  sequenceNames: string[];
  sequences: Array<{ name: string; frameCount: number }>;
  materialWarnings: string[];
}

export interface SwfBaselineHarness {
  version: number;
  ready: boolean;
  getEnvironment(): SwfBaselineEnvironment | null;
  getAtlasTileDebugInfo(): ReturnType<SwfPlayer["getAtlasTileDebugInfo"]>;
  setSequence(name: string): Promise<void>;
  gotoFrame(frame: number): Promise<void>;
  pause(): void;
  fitToView(): void;
  /** 导出单帧 RGBA（诊断/对比用，仅 DEV harness） */
  captureExportFrameRgba(options: {
    sequence: string;
    frame?: number;
    scale?: number;
    background?: number | "transparent";
  }): Promise<RgbaImage>;
  /** 将 PNG URL 解码为 RGBA（用于与参考基线对比） */
  loadReferencePng(url: string): Promise<RgbaImage>;
  /** 截取当前 viewer 画布为 RGBA */
  capturePreviewPixels(): Promise<RgbaImage>;
  /** 对比任意两帧 RGBA */
  detectTextureMisalignment(
    reference: RgbaImage,
    candidate: RgbaImage,
    options?: TextureAlignmentOptions,
  ): TextureAlignmentReport;
  /**
   * 将当前预览帧与参考 PNG 对比，检测纹理错位。
   * referenceUrl 通常为 `/examples/swf-baseline/.../preview/xxx.png`
   */
  comparePreviewToReference(
    referenceUrl: string,
    options?: TextureAlignmentOptions,
  ): Promise<TextureAlignmentReport & { referenceUrl: string }>;
  captureExportSequence(captureOptions: {
    sequence: string;
    scale?: number;
    background?: number | "transparent";
    renderFxLayers?: boolean;
  }): Promise<SwfBaselineExportFrame[]>;
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function countNonZeroAlphaPixels(pixels: Uint8Array, width: number, height: number): number {
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! > 0) count++;
    }
  }
  return count;
}

function getEffectiveMaxTextureSize(): number {
  return getEffectiveSwfMaxTextureSize();
}

async function loadReferencePng(url: string): Promise<RgbaImage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`无法加载参考图: ${url} (${response.status})`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 2d context");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    pixels: new Uint8Array(image.data),
  };
}

async function capturePreviewPixels(player: SwfBaselinePlayer): Promise<RgbaImage> {
  const canvas = player.getCanvas();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("canvas.toBlob 失败"));
    }, "image/png");
  });
  const bitmap = await createImageBitmap(blob);
  const scratch = document.createElement("canvas");
  scratch.width = bitmap.width;
  scratch.height = bitmap.height;
  const ctx = scratch.getContext("2d");
  if (!ctx) throw new Error("无法创建 2d context");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, scratch.width, scratch.height);
  return {
    width: scratch.width,
    height: scratch.height,
    pixels: new Uint8Array(image.data),
  };
}

export function installSwfBaselineHarness(options: {
  getPlayer: () => SwfBaselinePlayer | null;
  getClip: () => SwfClipData | null;
}): void {
  if (!import.meta.env.DEV) return;
  if ((window as Window & { __SEER_SWF_BASELINE__?: SwfBaselineHarness }).__SEER_SWF_BASELINE__) {
    return;
  }

  const harness: SwfBaselineHarness = {
    version: SWF_BASELINE_HARNESS_VERSION,
    get ready() {
      return options.getPlayer() != null && options.getClip() != null;
    },

    getEnvironment() {
      const player = options.getPlayer();
      const clip = options.getClip();
      if (!player || !clip) return null;
      const bitmapWidth = clip.atlas.width > 0 ? clip.atlas.width : clip.atlasWidth;
      const bitmapHeight = clip.atlas.height > 0 ? clip.atlas.height : clip.atlasHeight;
      return {
        harnessVersion: SWF_BASELINE_HARNESS_VERSION,
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio || 1,
        maxTextureSize: getEffectiveMaxTextureSize(),
        atlasLogical: { width: clip.atlasWidth, height: clip.atlasHeight },
        atlasBitmap: { width: bitmapWidth, height: bitmapHeight },
        atlasScaled:
          bitmapWidth !== clip.atlasWidth || bitmapHeight !== clip.atlasHeight,
        petId: clip.petId,
        frameRate: clip.frameRate,
        sequenceNames: clip.sequences.map((s) => s.name),
        sequences: clip.sequences.map((s) => ({
          name: s.name,
          frameCount: s.frames.length,
        })),
        materialWarnings: clip.materialWarnings,
      };
    },

    getAtlasTileDebugInfo() {
      return options.getPlayer()?.getAtlasTileDebugInfo() ?? null;
    },

    async setSequence(name) {
      const player = options.getPlayer();
      if (!player) throw new Error("播放器未就绪");
      player.setSequence(name);
      player.pause();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },

    async gotoFrame(frame) {
      const player = options.getPlayer();
      if (!player) throw new Error("播放器未就绪");
      player.gotoFrame(frame);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },

    pause() {
      options.getPlayer()?.pause();
    },

    fitToView() {
      options.getPlayer()?.fitToView();
    },

    async captureExportFrameRgba(captureOptions) {
      const player = options.getPlayer();
      if (!player) throw new Error("播放器未就绪");
      const targetFrame = captureOptions.frame ?? 0;
      for await (const frame of player.captureFrames({
        sequence: captureOptions.sequence,
        scale: captureOptions.scale ?? 1,
        background: captureOptions.background ?? "transparent",
      })) {
        if (frame.index !== targetFrame) continue;
        return {
          width: frame.width,
          height: frame.height,
          pixels: new Uint8Array(
            frame.pixels.buffer,
            frame.pixels.byteOffset,
            frame.pixels.byteLength,
          ),
        };
      }
      throw new Error(`未找到导出帧 ${targetFrame}`);
    },

    async captureExportSequence(captureOptions) {
      const player = options.getPlayer();
      if (!player) throw new Error("播放器未就绪");
      const out: SwfBaselineExportFrame[] = [];
      for await (const frame of player.captureFrames({
        sequence: captureOptions.sequence,
        scale: captureOptions.scale ?? 1,
        background: captureOptions.background ?? "transparent",
        renderFxLayers: captureOptions.renderFxLayers ?? true,
      })) {
        const pixels = new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
        out.push({
          index: frame.index,
          width: frame.width,
          height: frame.height,
          sha256: await sha256Hex(pixels),
          nonZeroAlphaPixels: countNonZeroAlphaPixels(pixels, frame.width, frame.height),
        });
      }
      return out;
    },

    async loadReferencePng(url) {
      return loadReferencePng(url);
    },

    async capturePreviewPixels() {
      const player = options.getPlayer();
      if (!player) throw new Error("播放器未就绪");
      return capturePreviewPixels(player);
    },

    detectTextureMisalignment(reference, candidate, alignmentOptions) {
      return detectTextureMisalignment(reference, candidate, alignmentOptions);
    },

    async comparePreviewToReference(referenceUrl, alignmentOptions) {
      const player = options.getPlayer();
      if (!player) throw new Error("播放器未就绪");
      const reference = await loadReferencePng(referenceUrl);
      const candidate = await capturePreviewPixels(player);
      const report = detectTextureMisalignment(reference, candidate, alignmentOptions);
      return { ...report, referenceUrl };
    },
  };

  (window as Window & { __SEER_SWF_BASELINE__?: SwfBaselineHarness }).__SEER_SWF_BASELINE__ =
    harness;
}
