import "./buffer-setup.js";
import { Buffer } from "buffer";
import * as unity from "@arkntools/unity-js";
import { loadUnityClipWithModule } from "./unity-clip.js";
import { rebuildPetCore, type RebuildResult } from "./rebuild-core.js";
import type { Clip, RebuildOptions } from "./types.js";

export type { Clip, RebuildOptions, TextureScale } from "./types.js";
export { validateTextureScale } from "./textures.js";

export function loadUnityClip(
  bytes: Uint8Array,
  sharedBytes: Uint8Array,
): Promise<Clip> {
  return loadUnityClipWithModule(bytes, sharedBytes, unity);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

/** 在 Worker 中运行：解码和重建会占用较多 CPU 和内存。 */
export async function rebuildPet(
  source: Uint8Array,
  clip: Clip,
  options: RebuildOptions = {},
): Promise<RebuildResult> {
  const sourceSha256 = await sha256(source);
  const result = rebuildPetCore(Buffer.from(source), clip, options);
  return {
    ...result,
    report: {
      ...result.report,
      sourceSha256,
      outputSha256: await sha256(result.swf),
    },
  };
}
