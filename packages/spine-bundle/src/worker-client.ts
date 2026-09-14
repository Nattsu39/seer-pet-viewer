import "./buffer-setup.js";
import type { SpineClipData, SpineClipJson } from "./types.js";
import { buildSpineClipData, closeSpineClipData } from "./clip-data.js";
let worker: Worker | null = null;
let requestId = 0;
interface Request {
  owner: Worker;
  resolve: (clip: SpineClipData) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}
const pending = new Map<number, Request>();
function failWorker(owner: Worker, reason: unknown): void {
  if (worker === owner) worker = null;
  owner.onmessage = null;
  owner.onerror = null;
  owner.onmessageerror = null;
  try {
    owner.terminate();
  } catch {
    /* Requests still settle. */
  }
  for (const [id, request] of pending) {
    if (request.owner !== owner) continue;
    pending.delete(id);
    request.cleanup();
    request.reject(reason);
  }
}
function retireIfIdle(owner: Worker): void {
  if (worker === owner && pending.size === 0)
    failWorker(owner, new Error("Spine parser idle"));
}
function getWorker(): Worker {
  if (worker) return worker;
  const owner = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  worker = owner;
  owner.onmessage = async (event: MessageEvent) => {
    const response = event.data;
    if (
      !response ||
      typeof response !== "object" ||
      !Number.isSafeInteger(response.id) ||
      typeof response.ok !== "boolean"
    ) {
      failWorker(owner, new Error("Invalid Spine worker response"));
      return;
    }
    const request = pending.get(response.id);
    if (!request || request.owner !== owner) {
      retireIfIdle(owner);
      return;
    }
    try {
      if (!response.ok) throw new Error(response.error ?? "Spine parse failed");
      const clip = await buildSpineClipData(
        response.meta as SpineClipJson,
        new Uint8Array(response.skeletonBytes as ArrayBuffer),
        (
          response.textures as Array<{
            name: string;
            width: number;
            height: number;
            rgba: ArrayBuffer;
          }>
        ).map((tex) => ({ ...tex, rgba: new Uint8ClampedArray(tex.rgba) })),
      );
      if (pending.get(response.id) !== request) {
        closeSpineClipData(clip);
        retireIfIdle(owner);
        return;
      }
      pending.delete(response.id);
      request.cleanup();
      request.resolve(clip);
      retireIfIdle(owner);
    } catch (error) {
      if (pending.get(response.id) === request) {
        pending.delete(response.id);
        request.cleanup();
        request.reject(error);
        retireIfIdle(owner);
      }
    }
  };
  owner.onerror = (event) =>
    failWorker(owner, new Error(event.message || "Spine worker failed"));
  owner.onmessageerror = () =>
    failWorker(owner, new Error("Spine worker message error"));
  return owner;
}
/** Cancellation stops waiting and discards late results, not other requests or decoding. */
export function parseSpineBundleInWorker(
  buffer: ArrayBuffer,
  fileName: string,
  options: { signal?: AbortSignal } = {},
): Promise<SpineClipData> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const owner = getWorker(),
      id = ++requestId;
    const abort = () => {
      pending.delete(id);
      cleanup();
      reject(new DOMException("Parse aborted", "AbortError"));
    };
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    pending.set(id, { owner, resolve, reject, cleanup });
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const copy = buffer.slice(0);
      owner.postMessage({ id, buffer: copy, fileName }, [copy]);
    } catch (error) {
      failWorker(owner, error);
    }
  });
}
export function terminateSpineParserWorker(): void {
  if (worker) failWorker(worker, new Error("Spine parser worker terminated"));
}
