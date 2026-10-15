// Keep importing the browser entry safe: unity-js compiles WASM on evaluation.
// These APIs still parse on the calling thread; browser callers should use Workers.
import type * as Parser from "./parse.js";

export async function detectBundleKind(
  ...args: Parameters<typeof Parser.detectBundleKind>
): ReturnType<typeof Parser.detectBundleKind> {
  const parser = await import("./parse.js");
  return parser.detectBundleKind(...args);
}

export async function parseSpineBundle(
  ...args: Parameters<typeof Parser.parseSpineBundle>
): ReturnType<typeof Parser.parseSpineBundle> {
  const parser = await import("./parse.js");
  return parser.parseSpineBundle(...args);
}

export async function parseSpineBundleCore(
  ...args: Parameters<typeof Parser.parseSpineBundleCore>
): ReturnType<typeof Parser.parseSpineBundleCore> {
  const parser = await import("./parse.js");
  return parser.parseSpineBundleCore(...args);
}

export async function parseSpineBundleMetadata(
  ...args: Parameters<typeof Parser.parseSpineBundleMetadata>
): ReturnType<typeof Parser.parseSpineBundleMetadata> {
  const parser = await import("./parse.js");
  return parser.parseSpineBundleMetadata(...args);
}
