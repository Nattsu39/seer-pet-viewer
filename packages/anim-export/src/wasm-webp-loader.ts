import wasmUrl from "wasm-webp/dist/esm/webp-wasm.wasm?url";
import createModule from "wasm-webp/dist/esm/webp-wasm.js";

interface WebPConfig {
  lossless: number;
  quality: number;
}

export interface WebPAnimationFrameInput {
  data: Uint8Array;
  duration: number;
  config?: WebPConfig;
}

type WasmModule = {
  VectorWebPAnimationFrame: new () => {
    push_back(frame: {
      duration: number;
      data: Uint8Array;
      config: WebPConfig;
      has_config: boolean;
    }): void;
  };
  encodeAnimation(
    width: number,
    height: number,
    hasAlpha: boolean,
    frames: InstanceType<WasmModule["VectorWebPAnimationFrame"]>,
  ): Uint8Array | null;
};

const defaultWebpConfig: WebPConfig = { lossless: 0, quality: 100 };

let modulePromise: Promise<WasmModule> | null = null;

function getModule(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = createModule({
      locateFile: (path: string) =>
        path.endsWith(".wasm") ? wasmUrl : path,
    }) as Promise<WasmModule>;
  }
  return modulePromise;
}

export async function encodeAnimationWasm(
  width: number,
  height: number,
  hasAlpha: boolean,
  frames: WebPAnimationFrameInput[],
): Promise<Uint8Array | null> {
  const module = await getModule();
  const frameVector = new module.VectorWebPAnimationFrame();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const hasConfig = frame.config !== undefined;
    const config = { ...defaultWebpConfig, ...frame.config };
    config.lossless = Math.min(1, Math.max(0, config.lossless));
    config.quality = Math.min(100, Math.max(0, config.quality));
    frameVector.push_back({
      duration: frame.duration,
      data: frame.data,
      config,
      has_config: hasConfig,
    });
    // push_back 已把像素拷入 WASM 堆，立即释放 JS 侧引用，
    // 让全帧像素不会与 WASM 堆内副本长期共存
    frames[i] = undefined as unknown as WebPAnimationFrameInput;
  }
  return module.encodeAnimation(width, height, hasAlpha, frameVector);
}
