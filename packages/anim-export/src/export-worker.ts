import { encodeGifFrames } from "./gif-encode.js";
import type {
  ExportWorkerBeginMessage,
  ExportWorkerInputMessage,
  ExportWorkerOutputMessage,
} from "./export-worker-protocol.js";
import { encodeAnimatedWebp } from "./webp-encode.js";
import type { CapturedFrame } from "./types.js";

type WorkerScope = {
  postMessage(
    message: ExportWorkerOutputMessage,
    transfer?: StructuredSerializeOptions,
  ): void;
  onmessage: ((event: MessageEvent<ExportWorkerInputMessage>) => void) | null;
};

const scope = self as unknown as WorkerScope;

let begin: ExportWorkerBeginMessage | null = null;
/** 已转移到 worker 的帧像素；编码时逐帧释放 */
const frames: Array<{ pixels: Uint8Array } | undefined> = [];

function postError(error: unknown) {
  scope.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

scope.onmessage = async (event: MessageEvent<ExportWorkerInputMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === "begin") {
      begin = msg;
      return;
    }
    if (msg.type === "frame") {
      frames.push({ pixels: msg.pixels });
      return;
    }
    if (msg.type === "finish") {
      if (!begin) throw new Error("编码未初始化");
      const { format, width, height, fps, background } = begin;
      const total = frames.length;
      if (!total) throw new Error("未能捕获任何帧");
      scope.postMessage({ type: "progress", done: 0, total });

      let bytes: Uint8Array;
      if (format === "gif") {
        bytes = encodeGifFrames(frames, {
          width,
          height,
          fps,
          loop: true,
          background,
          onFrameDone: (done, t) =>
            scope.postMessage({ type: "progress", done, total: t }),
        });
      } else {
        const captured: CapturedFrame[] = [];
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          if (!frame) continue;
          captured.push({ index: i, pixels: frame.pixels, width, height });
        }
        frames.length = 0;
        bytes = await encodeAnimatedWebp(captured, {
          width,
          height,
          fps,
          loop: true,
        });
        scope.postMessage({ type: "progress", done: total, total });
      }
      scope.postMessage({ type: "done", bytes }, { transfer: [bytes.buffer] });
    }
  } catch (error) {
    postError(error);
  }
};
