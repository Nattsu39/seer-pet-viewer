import type { SwfClipData, SwfMaterialState } from "./types.js";
import { atlasPixelsToBitmap } from "./atlas.js";
import {
  decodeAtlasPixels,
  decodeSwfBundleFrames,
  type DecodedSwfBundleFrames,
  type PackedSwfBundleDescriptor,
} from "./worker-protocol.js";

interface WorkerSuccessMessage {
  id: number;
  ok: true;
  descriptor: PackedSwfBundleDescriptor;
  floatBuffer: ArrayBuffer;
  uintBuffer: ArrayBuffer;
  /** Worker 已完成 padding 处理与位图化时使用 */
  atlasBitmap?: ImageBitmap;
  /** 回退路径：图集以 RGBA buffer 传输，由主线程位图化 */
  atlasBuffer?: ArrayBuffer;
}

interface WorkerErrorMessage {
  id: number;
  ok: false;
  error?: string;
}

type WorkerResponse = WorkerSuccessMessage | WorkerErrorMessage;

interface WorkerState {
  worker: Worker;
  terminated: boolean;
}

interface PendingRequest {
  id: number;
  worker: WorkerState;
  resolve: (value: SwfClipData) => void;
  reject: (reason: Error) => void;
  settled: boolean;
}

let currentWorker: WorkerState | null = null;
let requestId = 0;
const pending = new Map<number, PendingRequest>();
const active = new Map<number, PendingRequest>();

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.length > 0) return new Error(value);
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message.length > 0
  ) {
    return new Error(value.message);
  }
  return new Error(fallback);
}

function retireWorker(state: WorkerState): void {
  if (currentWorker === state) currentWorker = null;
  if (state.terminated) return;
  state.terminated = true;
  // Drop event handlers before terminate so queued events from this worker
  // cannot affect a replacement worker.
  state.worker.onmessage = null;
  state.worker.onerror = null;
  state.worker.onmessageerror = null;
  try {
    state.worker.terminate();
  } catch {
    // A synchronous terminate failure must not leave promises pending.
  }
}

function failWorker(state: WorkerState, reason: Error): void {
  const toReject: PendingRequest[] = [];
  for (const [id, request] of active) {
    if (request.worker !== state) continue;
    active.delete(id);
    pending.delete(id);
    toReject.push(request);
  }
  retireWorker(state);
  for (const request of toReject) {
    request.settled = true;
    request.reject(reason);
  }
}

function installWorkerHandlers(state: WorkerState): void {
  state.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    void handleWorkerMessage(state, event);
  };
  state.worker.onerror = (event: ErrorEvent) => {
    failWorker(state, asError(event, "解析 Worker 出错"));
  };
  state.worker.onmessageerror = () => {
    failWorker(state, new Error("解析 Worker 消息错误"));
  };
}

function getWorker(): WorkerState {
  if (currentWorker && !currentWorker.terminated) return currentWorker;

  const state: WorkerState = {
    worker: new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    }),
    terminated: false,
  };
  currentWorker = state;
  try {
    installWorkerHandlers(state);
  } catch (error) {
    failWorker(state, asError(error, "无法初始化解析 Worker"));
    throw error;
  }
  return state;
}

function settleWorkerIfIdle(state: WorkerState): void {
  if (pending.size === 0 && currentWorker === state) {
    // This must happen before bitmap conversion/decoding below.
    retireWorker(state);
  }
}

function settleRequest(
  request: PendingRequest,
  outcome: "resolve" | "reject",
  value: SwfClipData | Error,
): void {
  if (request.settled) return;
  request.settled = true;
  active.delete(request.id);
  pending.delete(request.id);
  if (outcome === "resolve") {
    request.resolve(value as SwfClipData);
  } else {
    request.reject(value as Error);
  }
}

function toClipData(
  parsed: DecodedSwfBundleFrames,
  atlas: ImageBitmap,
): SwfClipData {
  return {
    petId: parsed.petId,
    name: parsed.name,
    frameRate: parsed.frameRate,
    atlasWidth: parsed.atlasWidth,
    atlasHeight: parsed.atlasHeight,
    atlas,
    materialWarnings: parsed.materialWarnings,
    sequences: parsed.sequences,
  };
}

/**
 * 图集要么已经是 Worker 传过来的 ImageBitmap（此时主线程不接触整图 RGBA），
 * 要么是需要主线程位图化的 RGBA buffer。
 */
async function resolveAtlasBitmap(
  response: WorkerSuccessMessage,
): Promise<ImageBitmap> {
  if (response.atlasBitmap) return response.atlasBitmap;
  if (!response.atlasBuffer) {
    throw new Error("解析 Worker 未返回图集数据");
  }
  const pixels = decodeAtlasPixels(response.descriptor, response.atlasBuffer);
  const prepared = await atlasPixelsToBitmap(pixels);
  return prepared.bitmap;
}

async function handleWorkerMessage(
  state: WorkerState,
  event: MessageEvent<WorkerResponse>,
): Promise<void> {
  if (currentWorker !== state || state.terminated) return;

  const response = event.data;
  if (!response || typeof response !== "object") {
    failWorker(state, new Error("解析 Worker 返回了无效消息"));
    return;
  }
  const request = pending.get(response.id);
  if (!request || request.worker !== state) return;
  pending.delete(response.id);
  settleWorkerIfIdle(state);

  if (!response.ok) {
    settleRequest(request, "reject", new Error(response.error ?? "解析失败"));
    return;
  }

  try {
    const parsed = decodeSwfBundleFrames(
      response.descriptor,
      response.floatBuffer,
      response.uintBuffer,
    );
    const atlas = await resolveAtlasBitmap(response);
    settleRequest(request, "resolve", toClipData(parsed, atlas));
  } catch (error) {
    settleRequest(request, "reject", asError(error, "解析结果处理失败"));
  }
}

export function parseBundleInWorker(
  buffer: ArrayBuffer,
  fileName: string,
  materials?: Record<string, SwfMaterialState>,
): Promise<SwfClipData> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    let copy: ArrayBuffer;
    let state: WorkerState;
    try {
      copy = buffer.slice(0);
      state = getWorker();
    } catch (error) {
      reject(asError(error, "无法启动解析 Worker"));
      return;
    }

    const request: PendingRequest = {
      id,
      worker: state,
      resolve,
      reject,
      settled: false,
    };
    active.set(id, request);
    pending.set(id, request);
    try {
      state.worker.postMessage(
        { id, buffer: copy, fileName, materials },
        [copy],
      );
    } catch (error) {
      failWorker(state, asError(error, "无法发送解析请求"));
    }
  });
}

export function terminateParserWorker(): void {
  const state = currentWorker;
  const toReject: PendingRequest[] = [];
  for (const [id, request] of active) {
    if (state && request.worker !== state && !request.worker.terminated) {
      continue;
    }
    active.delete(id);
    pending.delete(id);
    toReject.push(request);
  }
  if (state) retireWorker(state);
  const reason = new Error("解析 Worker 已终止");
  for (const request of toReject) {
    request.settled = true;
    request.reject(reason);
  }
}
