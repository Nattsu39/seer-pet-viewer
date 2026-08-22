import type { ExportBackground, ExportFormat } from "./types.js";

export interface ExportWorkerBeginMessage {
  type: "begin";
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  background: ExportBackground;
}

export interface ExportWorkerFrameMessage {
  type: "frame";
  /** 紧凑 RGBA（w*h*4），buffer 已转移给 worker */
  pixels: Uint8Array;
}

export interface ExportWorkerFinishMessage {
  type: "finish";
}

export type ExportWorkerInputMessage =
  | ExportWorkerBeginMessage
  | ExportWorkerFrameMessage
  | ExportWorkerFinishMessage;

export interface ExportWorkerProgressMessage {
  type: "progress";
  done: number;
  total: number;
}

export interface ExportWorkerDoneMessage {
  type: "done";
  /** 编码产物，buffer 转移回主线程 */
  bytes: Uint8Array;
}

export interface ExportWorkerErrorMessage {
  type: "error";
  message: string;
}

export type ExportWorkerOutputMessage =
  | ExportWorkerProgressMessage
  | ExportWorkerDoneMessage
  | ExportWorkerErrorMessage;
