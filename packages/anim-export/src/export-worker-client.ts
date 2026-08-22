import type {
  ExportWorkerBeginMessage,
  ExportWorkerOutputMessage,
} from "./export-worker-protocol.js";
import type { ExportProgress } from "./types.js";

export interface ExportWorkerClient {
  begin(config: Omit<ExportWorkerBeginMessage, "type">): void;
  /** 转移 pixels 的 ArrayBuffer（主线程立即释放，零拷贝） */
  sendFrame(pixels: Uint8Array): void;
  finish(onProgress?: (progress: ExportProgress) => void): Promise<Uint8Array>;
  dispose(): void;
}

/**
 * 创建导出编码 worker；不可用时返回 null（回退到主线程内联编码）。
 * worker 在 finish/出错后由 dispose() 终止——WASM 堆只增不减，
 * 终止 worker 是把编码内存真正归还系统的唯一途径。
 */
export function createExportWorkerClient(): ExportWorkerClient | null {
  if (typeof Worker === "undefined") return null;
  let worker: Worker | null;
  try {
    worker = new Worker(new URL("./export-worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }

  let doneResolve: ((bytes: Uint8Array) => void) | null = null;
  let doneReject: ((error: Error) => void) | null = null;
  let progressSink: ((progress: ExportProgress) => void) | null = null;
  let finished = false;

  worker.onmessage = (event: MessageEvent<ExportWorkerOutputMessage>) => {
    const msg = event.data;
    if (msg.type === "progress") {
      progressSink?.({ phase: "encode", done: msg.done, total: msg.total });
      return;
    }
    finished = true;
    if (msg.type === "done") {
      doneResolve?.(msg.bytes);
    } else {
      doneReject?.(new Error(msg.message));
    }
    worker?.terminate();
    worker = null;
  };
  worker.onerror = (event: ErrorEvent) => {
    finished = true;
    doneReject?.(new Error(`导出 worker 异常: ${event.message}`));
    worker?.terminate();
    worker = null;
  };

  return {
    begin(config) {
      if (!worker) throw new Error("导出 worker 已终止");
      worker.postMessage({ type: "begin", ...config } satisfies ExportWorkerBeginMessage);
    },
    sendFrame(pixels) {
      if (!worker) throw new Error("导出 worker 已终止");
      const buffer = pixels.buffer;
      if (buffer.byteLength !== pixels.byteLength) {
        throw new Error("帧像素不是紧凑 buffer，无法转移");
      }
      worker.postMessage({ type: "frame", pixels }, [buffer]);
    },
    finish(onProgress) {
      if (!worker) {
        return Promise.reject(new Error("导出 worker 已终止"));
      }
      progressSink = onProgress ?? null;
      return new Promise<Uint8Array>((resolve, reject) => {
        doneResolve = resolve;
        doneReject = reject;
        worker!.postMessage({ type: "finish" });
      }).finally(() => {
        progressSink = null;
        doneResolve = null;
        doneReject = null;
        if (!finished) {
          worker?.terminate();
          worker = null;
        }
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
