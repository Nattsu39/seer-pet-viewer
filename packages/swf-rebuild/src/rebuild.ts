import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { Buffer } from "buffer";
import { rebuildPetCore, type RebuildResult } from "./rebuild-core.js";
import type { Clip, RebuildOptions } from "./types.js";

export { quadMatrix, unpackColor } from "./frames.js";

export type { RebuildResult } from "./rebuild-core.js";

/** Node.js 同步入口，同时计算输入和输出的校验和。 */
export function rebuildPet(
  source: Buffer,
  clip: Clip,
  options: RebuildOptions = {},
): RebuildResult {
  // 保持 CLI 已检查过的二进制输出；浏览器端则使用 fflate。
  const result = rebuildPetCore(source, clip, options, {
    deflate: deflateSync,
    inflate: inflateSync,
  });
  const sha256 = (bytes: Buffer): string =>
    createHash("sha256").update(bytes).digest("hex");
  return {
    ...result,
    report: {
      ...result.report,
      sourceSha256: sha256(source),
      outputSha256: sha256(result.swf),
    },
  };
}
