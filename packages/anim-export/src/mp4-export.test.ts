import { afterEach, expect, it, vi } from "vitest";
import { exportAnimation } from "./export.js";
import type { CaptureOptions, FrameCaptureSource } from "./types.js";
import { checkMp4Support } from "./mp4-support.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["configure", "callback", "encode", "flush"] as const)(
  "explains an unsupported runtime configuration from %s after capability detection succeeds",
  async (failure) => {
    const nativeError = new DOMException(
      "Unsupported configuration parameters.",
      failure === "callback" ? "EncodingError" : "NotSupportedError",
    );
    const restored = vi.fn();
    const close = vi.fn();
    const closeFrame = vi.fn();
    vi.stubGlobal(
      "VideoFrame",
      class {
        close = closeFrame;
      },
    );
    vi.stubGlobal(
      "VideoEncoder",
      class {
        state = "configured";
        static async isConfigSupported() {
          return { supported: true };
        }
        constructor(private callbacks: VideoEncoderInit) {}
        configure() {
          if (failure === "configure") throw nativeError;
        }
        encode() {
          if (failure === "encode") throw nativeError;
          if (failure === "callback")
            queueMicrotask(() => this.callbacks.error(nativeError));
        }
        async flush() {
          if (failure === "flush") throw nativeError;
        }
        close() {
          this.state = "closed";
          close();
        }
      },
    );
    const source: FrameCaptureSource = {
      getSequenceFrameCount: () => 1,
      getExportFps: () => 24,
      async *captureFrames() {
        try {
          yield {
            index: 0,
            width: 32,
            height: 16,
            pixels: new Uint8Array(32 * 16 * 4),
          };
        } finally {
          restored();
        }
      },
    };
    const progress = vi.fn();
    await expect(
      exportAnimation(
        source,
        {
          format: "mp4",
          sequence: "attack",
          scale: 1,
          background: 0,
        },
        progress,
      ),
    ).rejects.toMatchObject({
      message:
        "当前浏览器／设备无法使用本次设置导出 MP4（32×16，24 FPS）。请尝试降低倍率后重试，或更换浏览器／设备。",
      cause: nativeError,
    });
    expect(restored).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(closeFrame).toHaveBeenCalledTimes(failure === "configure" ? 0 : 1);
    expect(
      progress.mock.calls.some(([value]) => value.phase === "complete"),
    ).toBe(false);
  },
);

it("uses a higher AVC level for a supported 4096-square frame", async () => {
  const controller = new AbortController();
  const configure = vi.fn();
  vi.stubGlobal(
    "VideoFrame",
    class {
      close() {}
    },
  );
  vi.stubGlobal(
    "VideoEncoder",
    class {
      state = "configured";
      static async isConfigSupported(config: VideoEncoderConfig) {
        return {
          supported: config.width <= 640 || config.codec === "avc1.64003c",
        };
      }
      configure = configure;
      encode() {
        controller.abort();
      }
      close() {
        this.state = "closed";
      }
    },
  );
  const source: FrameCaptureSource = {
    getSequenceFrameCount: () => 1,
    getExportFps: () => 24,
    async *captureFrames() {
      yield {
        index: 0,
        width: 4096,
        height: 4096,
        pixels: new Uint8Array(4096 * 4096 * 4),
      };
    },
  };
  await expect(
    exportAnimation(source, {
      format: "mp4",
      sequence: "attack",
      scale: 1,
      background: 0,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(configure).toHaveBeenCalledWith(
    expect.objectContaining({
      codec: "avc1.64003c",
      width: 4096,
      height: 4096,
    }),
  );
});

it("bounds consumption and releases capture when cancellation interrupts a stalled encoder", async () => {
  const controller = new AbortController();
  const restored = vi.fn();
  const closeEncoder = vi.fn();
  const closeFrame = vi.fn();
  let captured = 0;
  vi.stubGlobal(
    "VideoFrame",
    class {
      close() {
        closeFrame();
      }
    },
  );
  vi.stubGlobal(
    "VideoEncoder",
    class {
      state = "configured";
      static async isConfigSupported() {
        return { supported: true };
      }
      configure() {}
      encode() {}
      flush() {
        setTimeout(() => controller.abort(), 0);
        return new Promise(() => {});
      }
      close() {
        this.state = "closed";
        closeEncoder();
      }
    },
  );
  const source: FrameCaptureSource = {
    getSequenceFrameCount: () => 500,
    getExportFps: () => 24,
    async *captureFrames() {
      try {
        for (let index = 0; index < 500; index++) {
          captured++;
          yield {
            index,
            width: 16,
            height: 16,
            pixels: new Uint8Array(16 * 16 * 4),
          };
        }
      } finally {
        restored();
      }
    },
  };
  await expect(
    exportAnimation(source, {
      format: "mp4",
      sequence: "standby",
      scale: 1,
      background: 0,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(captured).toBeGreaterThan(0);
  expect(captured).toBeLessThan(500);
  expect(closeFrame).toHaveBeenCalledTimes(captured);
  expect(closeEncoder).toHaveBeenCalledOnce();
  expect(restored).toHaveBeenCalledOnce();
});

it.each(["insecure", "missing-frame", "unsupported-codec"])(
  "reports %s capability without starting capture",
  async (failure) => {
    vi.stubGlobal("isSecureContext", failure !== "insecure");
    vi.stubGlobal(
      "VideoFrame",
      failure === "missing-frame" ? undefined : class {},
    );
    vi.stubGlobal(
      "VideoEncoder",
      class {
        static async isConfigSupported() {
          return { supported: false };
        }
      },
    );
    const capture = vi.fn();
    const source: FrameCaptureSource = {
      async *captureFrames() {
        capture();
      },
      getSequenceFrameCount: () => 1,
      getExportFps: () => 24,
    };
    const expected = {
      insecure: /HTTPS/,
      "missing-frame": /VideoFrame/,
      "unsupported-codec": /H.264/,
    }[failure]!;
    await expect(
      exportAnimation(source, {
        format: "mp4",
        sequence: "standby",
        scale: 1,
        background: 0,
      }),
    ).rejects.toThrow(expected);
    expect(capture).not.toHaveBeenCalled();
  },
);

it("rejects missing native video APIs before capturing any frames", async () => {
  vi.stubGlobal("VideoEncoder", undefined);
  const capture = vi.fn();
  const source: FrameCaptureSource = {
    async *captureFrames() {
      capture();
    },
    getSequenceFrameCount: () => 1,
    getExportFps: () => 24,
  };
  await expect(
    exportAnimation(source, {
      format: "mp4",
      sequence: "standby",
      scale: 1,
      background: 0x123456,
    }),
  ).rejects.toThrow(/VideoEncoder/);
  expect(capture).not.toHaveBeenCalled();
});

it("distinguishes a size limitation from unavailable H.264 and closes the frame source", async () => {
  const restored = vi.fn();
  const options: CaptureOptions[] = [];
  vi.stubGlobal("VideoFrame", class {});
  vi.stubGlobal(
    "VideoEncoder",
    class {
      static async isConfigSupported(config: VideoEncoderConfig) {
        return { supported: config.width <= 640 && config.height <= 480 };
      }
    },
  );
  const source: FrameCaptureSource = {
    async *captureFrames(captureOptions) {
      options.push(captureOptions);
      try {
        yield { index: 0, width: 1920, height: 1080, pixels: new Uint8Array() };
      } finally {
        restored();
      }
    },
    getSequenceFrameCount: () => 1,
    getExportFps: () => 30,
  };
  await expect(
    exportAnimation(source, {
      format: "mp4",
      sequence: "standby",
      scale: 3,
      background: 0,
    }),
  ).rejects.toThrow(/1920×1080.*降低倍率/);
  expect(options[0]).toMatchObject({
    scale: 3,
    maxSide: 4096,
    background: "transparent",
  });
  expect(restored).toHaveBeenCalledOnce();
  expect(await checkMp4Support()).toMatchObject({ supported: true });
});

it("does not blame dimensions when the original frame rate is unsupported", async () => {
  vi.stubGlobal("VideoFrame", class {});
  vi.stubGlobal(
    "VideoEncoder",
    class {
      static async isConfigSupported(config: VideoEncoderConfig) {
        return { supported: config.framerate === 30 };
      }
    },
  );
  const source: FrameCaptureSource = {
    async *captureFrames() {
      yield { index: 0, width: 32, height: 32, pixels: new Uint8Array() };
    },
    getSequenceFrameCount: () => 1,
    getExportFps: () => 120,
  };
  await expect(
    exportAnimation(source, {
      format: "mp4",
      sequence: "standby",
      scale: 1,
      background: 0,
      fps: 30,
    }),
  ).rejects.toThrow(/120 FPS/);
});

it("probes alternate H.264 profiles before declaring the format unavailable", async () => {
  vi.stubGlobal("VideoFrame", class {});
  vi.stubGlobal(
    "VideoEncoder",
    class {
      static async isConfigSupported(config: VideoEncoderConfig) {
        return { supported: config.codec === "avc1.42001f" };
      }
    },
  );
  expect(await checkMp4Support()).toMatchObject({ supported: true });
});

it("cancels a stalled capability query without ever starting capture", async () => {
  vi.stubGlobal("VideoFrame", class {});
  vi.stubGlobal(
    "VideoEncoder",
    class {
      static isConfigSupported() {
        return new Promise(() => {});
      }
    },
  );
  const capture = vi.fn();
  const controller = new AbortController();
  const source: FrameCaptureSource = {
    async *captureFrames() {
      capture();
    },
    getSequenceFrameCount: () => 1,
    getExportFps: () => 30,
  };
  const pending = exportAnimation(source, {
    format: "mp4",
    sequence: "standby",
    scale: 1,
    background: 0,
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(capture).not.toHaveBeenCalled();
});

it("composites odd frames without moving pixels and restores capture after an encoder failure", async () => {
  const frames: Array<{
    pixels: Uint8Array;
    init: VideoFrameBufferInit;
    closed: boolean;
  }> = [];
  const restored = vi.fn();
  vi.stubGlobal(
    "VideoFrame",
    class {
      record;
      constructor(pixels: Uint8Array, init: VideoFrameBufferInit) {
        this.record = { pixels: pixels.slice(), init, closed: false };
        frames.push(this.record);
      }
      close() {
        this.record.closed = true;
      }
    },
  );
  const close = vi.fn();
  vi.stubGlobal(
    "VideoEncoder",
    class {
      static async isConfigSupported() {
        return { supported: true };
      }
      state = "configured";
      constructor(private callbacks: VideoEncoderInit) {}
      configure() {}
      encode() {
        this.callbacks.error(new DOMException("device lost", "EncodingError"));
      }
      close() {
        this.state = "closed";
        close();
      }
    },
  );
  const source: FrameCaptureSource = {
    async *captureFrames(options) {
      expect(options.background).toBe("transparent");
      try {
        yield {
          index: 0,
          width: 3,
          height: 1,
          pixels: new Uint8Array([255, 0, 0, 128, 0, 0, 0, 0, 0, 255, 0, 255]),
        };
        throw new Error("must stop consuming frames");
      } finally {
        restored();
      }
    },
    getSequenceFrameCount: () => 2,
    getExportFps: () => 24,
  };
  await expect(
    exportAnimation(source, {
      format: "mp4",
      sequence: "standby",
      scale: 1,
      background: 0x0000ff,
    }),
  ).rejects.toThrow(/device lost/);
  expect(frames[0]).toMatchObject({
    init: { codedWidth: 4, codedHeight: 2, timestamp: 0, duration: 41667 },
    closed: true,
  });
  expect(Array.from(frames[0].pixels)).toEqual([
    128, 0, 127, 255, 0, 0, 255, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255,
  ]);
  expect(restored).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(await checkMp4Support()).toMatchObject({ supported: true });
});
