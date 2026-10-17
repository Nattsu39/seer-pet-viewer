import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import { abortable, throwIfAborted, yieldCaptureTask } from "./abort.js";
import { MAX_ANIMATION_FRAME_SIDE, validateCanvasSize } from "./canvas-size.js";
import { checkMp4Support, resolveMp4Config } from "./mp4-support.js";
import { compositeOpaqueVideoPixels } from "./video-frame.js";
import type {
  CapturedFrame,
  ExportOptions,
  ExportProgress,
  FrameCaptureSource,
} from "./types.js";

const MAX_PENDING_FRAMES = 8;
const MICROSECONDS_PER_SECOND = 1_000_000;
const KEY_FRAME_INTERVAL_SECONDS = 2;

export async function exportMp4(
  source: FrameCaptureSource,
  options: ExportOptions,
  onProgress?: (progress: ExportProgress) => void,
): Promise<Blob> {
  const task = new Mp4ExportTask(source, options, onProgress);
  return task.run();
}

/** Owns native encoder and muxer resources for exactly one export. */
class Mp4ExportTask {
  private readonly controller = new AbortController();
  private readonly signal = this.controller.signal;
  private readonly output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  private readonly packets = new EncodedVideoPacketSource("avc");
  private encoder?: VideoEncoder;
  private packetWrites = Promise.resolve();
  private completed = false;
  private total = 0;
  private fps = 0;
  private captured = 0;
  private encoded = 0;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private videoWidth = 0;
  private videoHeight = 0;

  constructor(
    private readonly source: FrameCaptureSource,
    private readonly options: ExportOptions,
    private readonly onProgress?: (progress: ExportProgress) => void,
  ) {}

  async run(): Promise<Blob> {
    const cancel = () => this.controller.abort(this.options.signal?.reason);
    this.options.signal?.addEventListener("abort", cancel, { once: true });
    if (this.options.signal?.aborted) cancel();
    try {
      await this.prepare();
      await this.captureAndEncode();
      return await this.finalize();
    } finally {
      this.options.signal?.removeEventListener("abort", cancel);
      await this.dispose();
    }
  }

  private async prepare(): Promise<void> {
    throwIfAborted(this.signal);
    this.report("prepare");
    this.total = this.source.getSequenceFrameCount(this.options.sequence);
    this.fps = this.source.getExportFps();
    if (this.total <= 0) throw new Error("当前序列没有可导出的帧");
    if (!Number.isFinite(this.fps) || this.fps <= 0) {
      throw new Error("无效的原始序列帧率");
    }
    if (this.options.background === "transparent") {
      throw new Error("MP4 导出必须指定当前背景色");
    }
    const support = await abortable(checkMp4Support(), this.signal);
    if (!support.supported) throw new Error(support.reason);
    this.output.addVideoTrack(this.packets, { frameRate: this.fps });
    await abortable(this.output.start(), this.signal);
  }

  private async captureAndEncode(): Promise<void> {
    const captureOptions = {
      ...this.options,
      background: "transparent" as const,
      maxSide: MAX_ANIMATION_FRAME_SIDE,
      signal: this.signal,
    };
    for await (const frame of this.source.captureFrames(captureOptions)) {
      throwIfAborted(this.signal);
      if (!this.encoder) await this.configureEncoder(frame);
      this.encodeFrame(frame);
      this.captured++;
      this.report("capture", this.captured);
      throwIfAborted(this.signal);
      // Bound native input and muxer writes even when the codec buffers output.
      // No sequence-sized array of raw frames is retained.
      if (this.captured % MAX_PENDING_FRAMES === 0) await this.drainEncoder();
    }
    if (!this.encoder || this.captured !== this.total) {
      throw new Error(`MP4 捕获帧数不完整（${this.captured}/${this.total}）`);
    }
    await this.drainEncoder();
    if (this.encoded !== this.captured) {
      throw new Error(`MP4 编码帧数不完整（${this.encoded}/${this.captured}）`);
    }
  }

  private async configureEncoder(frame: CapturedFrame): Promise<void> {
    validateCanvasSize(frame.width, frame.height, MAX_ANIMATION_FRAME_SIDE);
    this.sourceWidth = frame.width;
    this.sourceHeight = frame.height;
    this.videoWidth = frame.width + (frame.width % 2);
    this.videoHeight = frame.height + (frame.height % 2);
    const config = await abortable(
      resolveMp4Config(this.videoWidth, this.videoHeight, this.fps),
      this.signal,
    );
    try {
      this.encoder = new VideoEncoder({
        output: (chunk, metadata) => this.queuePacket(chunk, metadata),
        error: (error) =>
          this.controller.abort(this.createEncodingError(error)),
      });
      this.encoder.configure(config);
    } catch (error) {
      throwIfAborted(this.signal);
      throw this.createEncodingError(error);
    }
    throwIfAborted(this.signal);
  }

  private encodeFrame(frame: CapturedFrame): void {
    if (
      frame.width !== this.sourceWidth ||
      frame.height !== this.sourceHeight
    ) {
      throw new Error("导出帧尺寸不一致");
    }
    const timestamp = this.frameTimestamp(this.captured);
    const pixels = compositeOpaqueVideoPixels(
      frame,
      this.videoWidth,
      this.videoHeight,
      this.options.background as number,
    );
    const videoFrame = new VideoFrame(pixels, {
      format: "RGBA",
      codedWidth: this.videoWidth,
      codedHeight: this.videoHeight,
      timestamp,
      duration: this.frameTimestamp(this.captured + 1) - timestamp,
    });
    try {
      const keyFrameInterval = Math.max(
        1,
        Math.round(this.fps * KEY_FRAME_INTERVAL_SECONDS),
      );
      this.encoder!.encode(videoFrame, {
        keyFrame: this.captured % keyFrameInterval === 0,
      });
    } catch (error) {
      throwIfAborted(this.signal);
      throw this.createEncodingError(error);
    } finally {
      videoFrame.close();
    }
  }

  private frameTimestamp(index: number): number {
    return Math.round((index * MICROSECONDS_PER_SECOND) / this.fps);
  }

  private queuePacket(
    chunk: EncodedVideoChunk,
    metadata?: EncodedVideoChunkMetadata,
  ): void {
    if (this.signal.aborted) return;
    this.packetWrites = this.packetWrites
      .then(async () => {
        throwIfAborted(this.signal);
        await this.packets.add(EncodedPacket.fromEncodedChunk(chunk), metadata);
        this.encoded++;
      })
      .catch((error: unknown) => {
        this.controller.abort(
          new Error(
            `MP4 封装失败：${error instanceof Error ? error.message : error}`,
            { cause: error },
          ),
        );
      });
  }

  private async drainEncoder(): Promise<void> {
    this.report("encode", this.encoded);
    throwIfAborted(this.signal);
    try {
      await abortable(this.encoder!.flush(), this.signal);
    } catch (error) {
      throwIfAborted(this.signal);
      throw this.createEncodingError(error);
    }
    await abortable(this.packetWrites, this.signal);
    this.report("encode", this.encoded);
  }

  private async finalize(): Promise<Blob> {
    this.report("mux");
    await yieldCaptureTask(this.signal);
    await abortable(this.output.finalize(), this.signal);
    throwIfAborted(this.signal);
    const buffer = this.output.target.buffer;
    if (!buffer) throw new Error("MP4 封装未生成文件");
    this.report("complete", this.total);
    throwIfAborted(this.signal);
    this.completed = true;
    return new Blob([buffer], { type: "video/mp4" });
  }

  private report(phase: ExportProgress["phase"], done?: number): void {
    this.onProgress?.({
      phase,
      done: done ?? 0,
      total: done === undefined ? 0 : this.total,
    });
  }

  private createEncodingError(error: unknown): Error {
    const detail = error instanceof Error ? error.message : String(error);
    const unsupported =
      (error instanceof Error && error.name === "NotSupportedError") ||
      /unsupported configuration parameters/i.test(detail);
    // Support queries can succeed before the native encoder rejects startup.
    // That rejection does not establish which configuration field is unsupported.
    const message = unsupported
      ? `当前浏览器／设备无法使用本次设置导出 MP4（${this.videoWidth}×${this.videoHeight}，${this.fps} FPS）。请尝试降低倍率后重试，或更换浏览器／设备。`
      : `MP4 编码失败：${detail}`;
    return new Error(message, { cause: error });
  }

  private async dispose(): Promise<void> {
    if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
    if (this.completed) return;
    this.controller.abort();
    await this.packetWrites;
    await this.output.cancel();
  }
}
