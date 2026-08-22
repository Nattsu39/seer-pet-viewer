export type ExportFormat = "gif" | "webp";

export type ExportBackground = number | "transparent";

export interface CaptureOptions {
  sequence: string;
  scale: number;
  background: ExportBackground;
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
