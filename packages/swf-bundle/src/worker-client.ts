import type { SwfClipData, SwfClipJson, SwfMaterialState } from "./types.js";
import { atlasPixelsToBitmap } from "./atlas.js";
import { loadSwfClipPackage } from "./clip-data.js";

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<
  number,
  { resolve: (v: SwfClipData) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = async (event: MessageEvent) => {
      const { id, ok, meta, atlasRgba, atlasWidth, atlasHeight, error } =
        event.data;
      const handlers = pending.get(id);
      if (!handlers) return;
      pending.delete(id);
      if (!ok) {
        handlers.reject(new Error(error ?? "解析失败"));
        return;
      }
      const rgba = new Uint8ClampedArray(atlasRgba as ArrayBuffer);
      const prepared = await atlasPixelsToBitmap({
        width: atlasWidth as number,
        height: atlasHeight as number,
        rgba,
      });
      const clip = await loadSwfClipPackage(meta as SwfClipJson, prepared.bitmap, {
        atlasPrepared: true,
      });
      handlers.resolve(clip);
    };
    worker.onerror = (e) => {
      for (const [, h] of pending) h.reject(new Error(e.message));
      pending.clear();
    };
  }
  return worker;
}

export function parseBundleInWorker(
  buffer: ArrayBuffer,
  fileName: string,
  materials?: Record<string, SwfMaterialState>,
): Promise<SwfClipData> {
  const id = ++requestId;
  const copy = buffer.slice(0);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, buffer: copy, fileName, materials }, [copy]);
  });
}

export function terminateParserWorker(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
}
