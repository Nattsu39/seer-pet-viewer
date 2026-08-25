import type { SwfClipData, SwfMaterialState } from "./types.js";
import { atlasPixelsToBitmap } from "./atlas.js";
import { isSwfAtlasReleased } from "./clip-data.js";
import {
  decodeAtlasPixels,
  decodeSwfBundleFrames,
  type DecodedSwfBundleFrames,
  type PackedSwfBundleDescriptor,
  type ParserWorkerMode,
} from "./worker-protocol.js";

interface WorkerSuccessMessage {
  id: number;
  ok: true;
  descriptor?: PackedSwfBundleDescriptor;
  floatBuffer?: ArrayBuffer;
  uintBuffer?: ArrayBuffer;
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

interface PendingRequest<T> {
  id: number;
  worker: WorkerState;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  settled: boolean;
  finish: (response: WorkerSuccessMessage) => Promise<T>;
}

let currentWorker: WorkerState | null = null;
let requestId = 0;
const pending = new Map<number, PendingRequest<unknown>>();
const active = new Map<number, PendingRequest<unknown>>();

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
  const toReject: PendingRequest<unknown>[] = [];
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

/** 无 Worker 环境（node 测试等）下调用方应回退主线程解析 */
export function parserWorkerAvailable(): boolean {
  return typeof Worker !== "undefined";
}

function settleWorkerIfIdle(state: WorkerState): void {
  if (pending.size === 0 && currentWorker === state) {
    // This must happen before bitmap conversion/decoding below.
    retireWorker(state);
  }
}

function settleRequest<T>(
  request: PendingRequest<T>,
  outcome: "resolve" | "reject",
  value: T | Error,
): void {
  if (request.settled) return;
  request.settled = true;
  active.delete(request.id);
  pending.delete(request.id);
  if (outcome === "resolve") {
    request.resolve(value as T);
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
  if (!response.atlasBuffer || !response.descriptor) {
    throw new Error("解析 Worker 未返回图集数据");
  }
  const pixels = decodeAtlasPixels(response.descriptor, response.atlasBuffer);
  const prepared = await atlasPixelsToBitmap(pixels);
  return prepared.bitmap;
}

function decodeFramesResponse(
  response: WorkerSuccessMessage,
): DecodedSwfBundleFrames {
  if (!response.descriptor || !response.floatBuffer || !response.uintBuffer) {
    throw new Error("解析 Worker 未返回帧数据");
  }
  return decodeSwfBundleFrames(
    response.descriptor,
    response.floatBuffer,
    response.uintBuffer,
  );
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
    const value = await request.finish(response);
    settleRequest(request, "resolve", value);
  } catch (error) {
    settleRequest(request, "reject", asError(error, "解析结果处理失败"));
  }
}

interface WorkerRequestPayload {
  mode?: ParserWorkerMode;
  fileName?: string;
  materials?: Record<string, SwfMaterialState>;
}

function requestWorkerParse<T>(
  buffer: ArrayBuffer,
  payload: WorkerRequestPayload,
  finish: (response: WorkerSuccessMessage) => Promise<T>,
): Promise<T> {
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

    const request: PendingRequest<T> = {
      id,
      worker: state,
      resolve,
      reject,
      settled: false,
      finish,
    };
    active.set(id, request as PendingRequest<unknown>);
    pending.set(id, request as PendingRequest<unknown>);
    try {
      state.worker.postMessage({ id, buffer: copy, ...payload }, [copy]);
    } catch (error) {
      failWorker(state, asError(error, "无法发送解析请求"));
    }
  });
}

export function parseBundleInWorker(
  buffer: ArrayBuffer,
  fileName: string,
  materials?: Record<string, SwfMaterialState>,
): Promise<SwfClipData> {
  return requestWorkerParse(
    buffer,
    { mode: "full", fileName, materials },
    async (response) => {
      const parsed = decodeFramesResponse(response);
      const atlas = await resolveAtlasBitmap(response);
      return toClipData(parsed, atlas);
    },
  );
}

/**
 * 在 Worker 内重解析 mesh 材质（导入共享材质后）。
 * 图集仍存活时不解码、不传输图集，只重算帧；已释放时在 Worker 内重解码，
 * 避免旧实现在主线程留下永不回收的 wasm 线性内存（实测 >500 MB）。
 */
export function reparseSwfClipInWorker(
  buffer: ArrayBuffer,
  fileName: string,
  materials: Record<string, SwfMaterialState> | undefined,
  atlas: ImageBitmap,
): Promise<SwfClipData> {
  const needAtlas = isSwfAtlasReleased(atlas);
  return requestWorkerParse(
    buffer,
    { mode: needAtlas ? "full" : "frames", fileName, materials },
    async (response) => {
      const parsed = decodeFramesResponse(response);
      const clipAtlas = needAtlas ? await resolveAtlasBitmap(response) : atlas;
      return toClipData(parsed, clipAtlas);
    },
  );
}

/** 仅在 Worker 内重解码图集位图（分块渲染释放原图集后的 remount 用） */
export function extractAtlasBitmapInWorker(
  buffer: ArrayBuffer,
): Promise<ImageBitmap> {
  return requestWorkerParse(buffer, { mode: "atlas" }, resolveAtlasBitmap);
}

export function terminateParserWorker(): void {
  const state = currentWorker;
  const toReject: PendingRequest<unknown>[] = [];
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
