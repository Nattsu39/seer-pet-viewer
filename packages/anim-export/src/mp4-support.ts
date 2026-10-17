export interface Mp4Support {
  supported: boolean;
  reason: string;
}

const PROBE_WIDTH = 640;
const PROBE_HEIGHT = 480;
const PROBE_FPS = 30;
const MIN_BITRATE = 2_000_000;
const MAX_BITRATE = 60_000_000;
const BITS_PER_PIXEL_PER_FRAME = 0.3;

// Prefer a lower level for playback compatibility, then try larger configurations.
// Rejecting one profile/level is not a browser-wide verdict about H.264.
const AVC_CODECS = [
  "avc1.64001f",
  "avc1.4d001f",
  "avc1.42001f",
  "avc1.640028",
  "avc1.4d0028",
  "avc1.640034",
  "avc1.4d0034",
  "avc1.420034",
  // A 4096×4096 frame exceeds Level 5.2's coded-area limit.
  "avc1.64003c", // Level 6.0
  "avc1.4d003c",
  "avc1.42003c",
  "avc1.64003d", // Level 6.1
  "avc1.4d003d",
  "avc1.42003d",
  "avc1.64003e", // Level 6.2
  "avc1.4d003e",
  "avc1.42003e",
];

export async function checkMp4Support(): Promise<Mp4Support> {
  if (globalThis.isSecureContext === false) {
    return {
      supported: false,
      reason: "MP4 需要安全上下文，请使用 HTTPS 或 localhost。",
    };
  }
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoEncoder.isConfigSupported !== "function"
  ) {
    return { supported: false, reason: "当前环境缺少原生 VideoEncoder API。" };
  }
  if (typeof VideoFrame === "undefined") {
    return { supported: false, reason: "当前环境缺少原生 VideoFrame API。" };
  }
  try {
    const config = await findSupportedAvcConfig(
      PROBE_WIDTH,
      PROBE_HEIGHT,
      PROBE_FPS,
    );
    return config
      ? { supported: true, reason: "" }
      : {
          supported: false,
          reason: "未检测到可用的原生 H.264 编码配置，无法导出 MP4。",
        };
  } catch (error) {
    return {
      supported: false,
      reason: `MP4 能力检测失败：${error instanceof Error ? error.message : error}`,
    };
  }
}

export async function resolveMp4Config(
  width: number,
  height: number,
  fps: number,
): Promise<VideoEncoderConfig> {
  const config = await findSupportedAvcConfig(width, height, fps);
  if (config) return config;
  // Keep bitrate and frame rate identical to isolate a dimension limitation.
  const bitrate = calculateVideoBitrate(width, height, fps);
  if (await findSupportedAvcConfig(PROBE_WIDTH, PROBE_HEIGHT, fps, bitrate)) {
    throw new Error(
      `当前浏览器／设备不支持 ${width}×${height} 的 MP4 视频编码。请尝试降低倍率后重试，或更换浏览器／设备。`,
    );
  }
  throw new Error(
    `MP4 不支持本次编码配置（${width}×${height}，${fps} FPS）；请更换支持此配置的浏览器或设备。`,
  );
}

function calculateVideoBitrate(
  width: number,
  height: number,
  fps: number,
): number {
  return Math.round(
    Math.min(
      MAX_BITRATE,
      Math.max(MIN_BITRATE, width * height * fps * BITS_PER_PIXEL_PER_FRAME),
    ),
  );
}

async function findSupportedAvcConfig(
  width: number,
  height: number,
  fps: number,
  bitrate = calculateVideoBitrate(width, height, fps),
): Promise<VideoEncoderConfig | undefined> {
  for (const codec of AVC_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      framerate: fps,
      bitrate,
      latencyMode: "realtime",
      avc: { format: "avc" },
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (support.supported) return config;
  }
}
