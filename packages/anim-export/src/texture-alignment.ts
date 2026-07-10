import { DEFAULT_ALPHA_THRESHOLD } from "./alpha-bounds.js";

export interface RgbaImage {
  pixels: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export type TextureAlignmentVerdict =
  | "ok"
  | "minor_diff"
  | "shift_misalign"
  | "texture_misalign"
  | "insufficient";

export interface TextureAlignmentOptions {
  /** 单通道最大差超过此值视为不匹配像素 */
  tolerance?: number;
  /** 在 ±maxShift 范围内搜索最佳平移 */
  maxShift?: number;
  /** 不匹配率低于此值视为 ok */
  okMismatchRatio?: number;
  /** 不匹配率高于此值且平移无法解释时视为纹理错位 */
  severeMismatchRatio?: number;
  /** 平移校正带来的不匹配下降比例超过此值视为 shift 错位 */
  shiftGainThreshold?: number;
  alphaThreshold?: number;
}

export interface TextureAlignmentReport {
  verdict: TextureAlignmentVerdict;
  misaligned: boolean;
  referenceSize: { width: number; height: number };
  candidateSize: { width: number; height: number };
  overlapSize: { width: number; height: number };
  sizeMismatch: boolean;
  comparedPixels: number;
  mismatchPixels: number;
  mismatchRatio: number;
  meanAbsDelta: number;
  bestShift: { dx: number; dy: number };
  shiftCorrectedMismatchPixels: number;
  shiftCorrectedMismatchRatio: number;
  shiftGain: number;
}

export const DEFAULT_TEXTURE_ALIGNMENT_TOLERANCE = 3;
export const DEFAULT_TEXTURE_ALIGNMENT_MAX_SHIFT = 16;
export const DEFAULT_TEXTURE_MISMATCH_OK = 0.01;
export const DEFAULT_TEXTURE_MISMATCH_SEVERE = 0.05;
export const DEFAULT_TEXTURE_SHIFT_GAIN_THRESHOLD = 0.35;

interface ShiftScore {
  dx: number;
  dy: number;
  compared: number;
  mismatch: number;
  meanAbs: number;
}

function scoreShift(
  reference: RgbaImage,
  candidate: RgbaImage,
  overlapWidth: number,
  overlapHeight: number,
  dx: number,
  dy: number,
  tolerance: number,
  alphaThreshold: number,
): Omit<ShiftScore, "dx" | "dy"> {
  const rp = reference.pixels;
  const cp = candidate.pixels;
  const rw = reference.width;
  const cw = candidate.width;

  let compared = 0;
  let mismatch = 0;
  let absSum = 0;

  for (let y = 0; y < overlapHeight; y++) {
    for (let x = 0; x < overlapWidth; x++) {
      const x2 = x + dx;
      const y2 = y + dy;
      if (x2 < 0 || y2 < 0 || x2 >= overlapWidth || y2 >= overlapHeight) {
        continue;
      }
      const refIndex = (y * rw + x) * 4;
      const curIndex = (y2 * cw + x2) * 4;
      if (rp[refIndex + 3]! <= alphaThreshold && cp[curIndex + 3]! <= alphaThreshold) {
        continue;
      }
      compared++;
      const delta = Math.max(
        Math.abs(rp[refIndex]! - cp[curIndex]!),
        Math.abs(rp[refIndex + 1]! - cp[curIndex + 1]!),
        Math.abs(rp[refIndex + 2]! - cp[curIndex + 2]!),
        Math.abs(rp[refIndex + 3]! - cp[curIndex + 3]!),
      );
      absSum += delta;
      if (delta > tolerance) mismatch++;
    }
  }

  return {
    compared,
    mismatch,
    meanAbs: compared > 0 ? absSum / compared : 0,
  };
}

function classifyVerdict(
  comparedPixels: number,
  mismatchRatio: number,
  shiftGain: number,
  bestShift: { dx: number; dy: number },
  options: Required<
    Pick<
      TextureAlignmentOptions,
      | "okMismatchRatio"
      | "severeMismatchRatio"
      | "shiftGainThreshold"
    >
  >,
): TextureAlignmentVerdict {
  if (comparedPixels < 100) return "insufficient";
  if (mismatchRatio < options.okMismatchRatio) return "ok";
  const shifted =
    (bestShift.dx !== 0 || bestShift.dy !== 0) &&
    shiftGain >= options.shiftGainThreshold;
  if (shifted) return "shift_misalign";
  if (mismatchRatio >= options.severeMismatchRatio) return "texture_misalign";
  return "minor_diff";
}

/**
 * 对比参考图与候选图，检测整体平移型错位与纹理内容错位。
 * 两图尺寸可不同，仅比较左上角重叠区域。
 */
export function detectTextureMisalignment(
  reference: RgbaImage,
  candidate: RgbaImage,
  options: TextureAlignmentOptions = {},
): TextureAlignmentReport {
  const tolerance = options.tolerance ?? DEFAULT_TEXTURE_ALIGNMENT_TOLERANCE;
  const maxShift = options.maxShift ?? DEFAULT_TEXTURE_ALIGNMENT_MAX_SHIFT;
  const okMismatchRatio = options.okMismatchRatio ?? DEFAULT_TEXTURE_MISMATCH_OK;
  const severeMismatchRatio =
    options.severeMismatchRatio ?? DEFAULT_TEXTURE_MISMATCH_SEVERE;
  const shiftGainThreshold =
    options.shiftGainThreshold ?? DEFAULT_TEXTURE_SHIFT_GAIN_THRESHOLD;
  const alphaThreshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;

  const overlapWidth = Math.min(reference.width, candidate.width);
  const overlapHeight = Math.min(reference.height, candidate.height);
  const sizeMismatch =
    reference.width !== candidate.width || reference.height !== candidate.height;

  const base = scoreShift(
    reference,
    candidate,
    overlapWidth,
    overlapHeight,
    0,
    0,
    tolerance,
    alphaThreshold,
  );

  let best: ShiftScore = { dx: 0, dy: 0, ...base };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      if (dx === 0 && dy === 0) continue;
      const score = scoreShift(
        reference,
        candidate,
        overlapWidth,
        overlapHeight,
        dx,
        dy,
        tolerance,
        alphaThreshold,
      );
      if (score.compared > 0 && score.mismatch < best.mismatch) {
        best = { dx, dy, ...score };
      }
    }
  }

  const mismatchRatio = base.compared > 0 ? base.mismatch / base.compared : 0;
  const shiftCorrectedMismatchRatio =
    best.compared > 0 ? best.mismatch / best.compared : 0;
  const shiftGain =
    base.mismatch > 0 ? (base.mismatch - best.mismatch) / base.mismatch : 0;

  const verdict = classifyVerdict(base.compared, mismatchRatio, shiftGain, best, {
    okMismatchRatio,
    severeMismatchRatio,
    shiftGainThreshold,
  });

  return {
    verdict,
    misaligned: verdict === "shift_misalign" || verdict === "texture_misalign",
    referenceSize: { width: reference.width, height: reference.height },
    candidateSize: { width: candidate.width, height: candidate.height },
    overlapSize: { width: overlapWidth, height: overlapHeight },
    sizeMismatch,
    comparedPixels: base.compared,
    mismatchPixels: base.mismatch,
    mismatchRatio,
    meanAbsDelta: base.meanAbs,
    bestShift: { dx: best.dx, dy: best.dy },
    shiftCorrectedMismatchPixels: best.mismatch,
    shiftCorrectedMismatchRatio,
    shiftGain,
  };
}
