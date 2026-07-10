import type { SwfBaselineHarness } from "./lib/swf-baseline-harness";

declare global {
  interface Window {
    __SEER_SWF_BASELINE__?: SwfBaselineHarness;
  }
}

export {};
