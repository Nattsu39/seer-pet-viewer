import { describe, expect, it } from "vitest";
import {
  SWF_HIGH_PRECISION_ATLAS_MAX_SIDE,
  useHighPrecisionAtlasSampling,
} from "./swf-shader.js";

describe("useHighPrecisionAtlasSampling", () => {
  it("enables highp for atlas sides up to 2048", () => {
    expect(SWF_HIGH_PRECISION_ATLAS_MAX_SIDE).toBe(2048);
    expect(useHighPrecisionAtlasSampling(2048, 1024)).toBe(true);
    expect(useHighPrecisionAtlasSampling(1024, 2048)).toBe(true);
  });

  it("uses legacy mediump for larger atlas or tile sizes", () => {
    expect(useHighPrecisionAtlasSampling(2049, 1024)).toBe(false);
    expect(useHighPrecisionAtlasSampling(4096, 4096)).toBe(false);
    expect(useHighPrecisionAtlasSampling(8192, 8192)).toBe(false);
  });
});
