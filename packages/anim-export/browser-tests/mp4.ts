import {
  exportAnimation,
  checkMp4Support,
  type ExportProgress,
  type FrameCaptureSource,
} from "../src/index.js";
import { streamCapturedFrames } from "../src/frame-stream.js";

const FRAME_COUNT = 25;
const FPS = 24000 / 1001;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createSyntheticSource(): FrameCaptureSource {
  return {
    getSequenceFrameCount: () => FRAME_COUNT,
    getExportFps: () => FPS,
    async *captureFrames(options) {
      yield* streamCapturedFrames(
        FRAME_COUNT,
        (index) => {
          const width = 65,
            height = 33;
          const pixels = new Uint8Array(width * height * 4);
          for (let y = 4; y < 29; y++) {
            for (let x = 6; x < 22; x++) {
              pixels.set(
                [255, 40, 20, x < 10 ? 128 : 255],
                (y * width + x + index) * 4,
              );
            }
          }
          return { width, height, pixels };
        },
        true,
        options.signal,
      );
    },
  };
}

export async function runMp4BrowserTests() {
  const support = await checkMp4Support();
  assert(support.supported, support.reason);
  const source = createSyntheticSource();
  const options = {
    sequence: "standby",
    scale: 1,
    background: 0x143c96,
    format: "mp4" as const,
  };
  const phases: ExportProgress["phase"][] = [];
  const blob = await exportAnimation(source, options, ({ phase }) =>
    phases.push(phase),
  );
  assert(blob.type === "video/mp4", "Wrong MIME type");
  assert(phases.at(-1) === "complete", "Completion must follow muxing");
  const gif = await exportAnimation(source, {
    ...options,
    background: "transparent",
    format: "gif",
  });
  const gifHeader = new DataView(await gif.slice(0, 10).arrayBuffer());
  const width = gifHeader.getUint16(6, true);
  const height = gifHeader.getUint16(8, true);
  const playback = await playVideo(blob);
  assert(
    playback.width === width + (width % 2) &&
      playback.height === height + (height % 2),
    "MP4 differs from transparent GIF geometry",
  );
  assert(
    Math.abs(playback.duration - FRAME_COUNT / FPS) < 0.002,
    "MP4 changed the source timeline",
  );

  for (const phase of [
    "prepare",
    "capture",
    "encode",
    "mux",
    "complete",
  ] as const) {
    const controller = new AbortController();
    let canceled = false;
    try {
      await exportAnimation(
        source,
        { ...options, signal: controller.signal },
        (progress) => {
          if (progress.phase === phase) controller.abort();
        },
      );
    } catch (error) {
      canceled = error instanceof DOMException && error.name === "AbortError";
    }
    assert(canceled, `Cancellation at ${phase} returned a downloadable file`);
  }
  // A new task must work after every cancellation path.
  await exportAnimation(source, options);
  return {
    userAgent: navigator.userAgent,
    support,
    width: playback.width,
    height: playback.height,
    frameCount: FRAME_COUNT,
    fps: FPS,
    duration: playback.duration,
    phases: [...new Set(phases)],
    bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
  };
}

export async function playVideo(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.controls = true;
  video.playbackRate = 4;
  video.style.cssText =
    "position:fixed;inset:0;max-width:100vw;max-height:100vh;z-index:100";
  document.body.append(video);
  let timeout: ReturnType<typeof setTimeout>;
  const stalled = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new Error(
            `Video playback stalled: ${video.currentTime}/${video.duration}, readyState=${video.readyState}, error=${video.error?.message}`,
          ),
        ),
      30_000,
    );
  });
  try {
    video.src = url;
    await Promise.race([
      stalled,
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () =>
          reject(new Error(video.error?.message || "Video playback failed"));
      }),
    ]);
    const ended = new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () =>
        reject(new Error(video.error?.message || "Video playback failed"));
    });
    await video.play();
    await Promise.race([ended, stalled]);
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  } finally {
    clearTimeout(timeout!);
    video.remove();
    video.src = "";
    URL.revokeObjectURL(url);
  }
}
