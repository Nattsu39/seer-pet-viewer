import type {
  BundleMetadataRequest,
  BundleMetadataResponse,
  BundleMetadataResults,
} from "./bundle-metadata-protocol";

/** One worker per request keeps WASM compilation and bundle memory off the UI thread. */
export function readBundleMetadata<T extends BundleMetadataRequest["type"]>(
  type: T,
  buffer: ArrayBuffer,
  signal: AbortSignal,
): Promise<BundleMetadataResults[T]> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(
      new URL("./bundle-metadata.worker.ts", import.meta.url),
      { type: "module" },
    );

    function cleanup(): void {
      signal.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    function fail(error: unknown): void {
      cleanup();
      reject(error);
    }
    function onAbort(): void {
      fail(signal.reason);
    }

    signal.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<BundleMetadataResponse>) => {
      const response = event.data;
      cleanup();
      if (!response.ok) reject(new Error(response.error));
      else if (response.type !== type)
        reject(new Error("资源元数据类型不匹配"));
      else resolve(response.result as BundleMetadataResults[T]);
    };
    worker.onerror = (event) =>
      fail(new Error(event.message || "资源元数据 Worker 运行失败"));
    worker.onmessageerror = () => fail(new Error("无法读取资源元数据"));
    try {
      // The caller keeps the original bundle for parsing, remounting and export.
      const copy = buffer.slice(0);
      worker.postMessage(
        { type, buffer: copy } satisfies BundleMetadataRequest,
        [copy],
      );
    } catch (error) {
      fail(error);
    }
  });
}
