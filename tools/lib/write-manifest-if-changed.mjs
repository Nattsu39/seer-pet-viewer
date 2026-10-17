import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";

/**
 * updatedAt 表示清单内容的更新时间；仅检查时间变化时保留原文件。
 * @param {string} path
 * @param {Record<string, unknown>} manifest
 * @returns {boolean} 是否写入了文件
 */
export function writeManifestIfChanged(path, manifest) {
  let previous;
  try {
    previous = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (
    previous &&
    isDeepStrictEqual(
      { ...previous, updatedAt: undefined },
      { ...manifest, updatedAt: undefined },
    )
  ) {
    return false;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return true;
}
