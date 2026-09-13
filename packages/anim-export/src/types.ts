import type { BattleViewportOptions } from "./battle-viewport.js";

export type ExportFormat = "gif" | "webp";

export type ExportBackground = number | "transparent";

/** 战斗视口捕获参数（与 planBattleViewportExport 的选项为同一定义） */
export type BattleCaptureOptions = BattleViewportOptions;

/** 普通导出的固定像素视口，以资源参考序列中心取景；不随倍率改变尺寸。 */
export interface ExportViewport {
  width: number;
  height: number;
}

export interface ExportViewportCrop {
  requested: ExportViewport;
  output: ExportViewport;
  maxSide: number;
}

export interface CaptureOptions {
  sequence: string;
  scale: number;
  background: ExportBackground;
  battle?: BattleCaptureOptions;
  viewport?: ExportViewport;
  /** 编码入口按格式传入；捕获源应在创建画布前裁剪，保留内容倍率。 */
  maxSide?: number;
  onViewportCrop?: (crop: ExportViewportCrop) => void;
}

export interface CapturedFrame {
  index: number;
  pixels: Uint8Array;
  width: number;
  height: number;
}

export interface ExportOptions extends CaptureOptions {
  format: ExportFormat;
  fps?: number;
}

export interface PngSequenceOptions extends CaptureOptions {
  petId: number;
}

export interface ExportProgress {
  phase: "capture" | "encode";
  done: number;
  total: number;
}

export interface FrameCaptureSource {
  captureFrames(options: CaptureOptions): AsyncGenerator<CapturedFrame>;
  getSequenceFrameCount(sequence: string): number;
  getExportFps(): number;
}
