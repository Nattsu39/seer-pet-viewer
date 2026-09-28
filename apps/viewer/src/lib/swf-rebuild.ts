import type {
  SwfRebuildRequest,
  SwfRebuildResponse,
} from "./swf-rebuild-protocol";

/** Each export owns its worker so cancellation also releases decoded textures. */
export function rebuildSwfInWorker(
  request: SwfRebuildRequest,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const worker = new Worker(
    new URL("./swf-rebuild.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );

  return new Promise<ArrayBuffer>((resolve, reject) => {
    function cleanup(): void {
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
    }
    function onAbort(): void {
      cleanup();
      reject(signal.reason);
    }
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<SwfRebuildResponse>) => {
      const result = event.data;
      if (result.type === "progress") {
        onProgress(result.message);
        return;
      }
      cleanup();
      if (result.type === "complete") resolve(result.buffer);
      else reject(new Error(result.message));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "SWF 导出 Worker 运行失败"));
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error("无法读取 SWF 导出结果"));
    };
    try {
      // Clone the buffers; transferring them would detach the viewer's source.
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
