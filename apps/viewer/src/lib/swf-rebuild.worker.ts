import {
  loadUnityClip,
  rebuildPet,
  validateTextureScale,
} from "@seer-pet-anim/swf-rebuild/browser";
import type {
  SwfRebuildRequest,
  SwfRebuildResponse,
} from "./swf-rebuild-protocol";

function progress(message: string): void {
  self.postMessage({ type: "progress", message } satisfies SwfRebuildResponse);
}

self.onmessage = async (event: MessageEvent<SwfRebuildRequest>) => {
  try {
    const { petId, bundle, materials, textureScale } = event.data;
    validateTextureScale(textureScale);
    if (!Number.isSafeInteger(petId) || petId <= 0) {
      throw new Error("无法识别精灵编号，不能获取对应的原始 SWF");
    }

    progress("正在加载原始 SWF…");
    const response = await fetch(
      `https://seer.61.com/resource/fightResource/pet/swf/${petId}.swf`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!response.ok) {
      throw new Error(`原始 SWF 加载失败（HTTP ${response.status}）`);
    }
    const source = new Uint8Array(await response.arrayBuffer());

    progress("正在解析 bundle…");
    const clip = await loadUnityClip(
      new Uint8Array(bundle),
      new Uint8Array(materials),
    );
    progress("正在重建 SWF…");
    const result = await rebuildPet(source, clip, {
      textureScale,
      includePreviews: false,
    });
    const buffer = Uint8Array.from(result.swf).buffer;
    self.postMessage(
      { type: "complete", buffer } satisfies SwfRebuildResponse,
      { transfer: [buffer] },
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies SwfRebuildResponse);
  }
};
