import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { streamCapturedFrames } from "./frame-stream.js";
import { tightCropRgbaFrames } from "./export-dimensions.js";

beforeEach(() => vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { queueMicrotask(() => fn(0)); return 1; }));
afterEach(() => vi.unstubAllGlobals());

function render(index: number) {
  const width = 40, height = 30;
  const pixels = new Uint8Array(width * height * 4);
  // Moving content: every output must use the union, not a per-frame crop.
  for (let y = 6; y < 12; y++) for (let x = 8 + index; x < 14 + index; x++) {
    pixels.set([70 + index, 20, 60, 255], (y * width + x) * 4);
  }
  return { pixels, width, height };
}

it("hands off fixed viewport frames on demand and stops work when the consumer closes", async () => {
  const capture = vi.fn(render);
  const stream = streamCapturedFrames(118, capture, false);
  expect(capture).not.toHaveBeenCalled();
  const first = await stream.next();
  expect(first.value).toEqual({ index: 0, ...render(0) });
  expect(capture).toHaveBeenCalledTimes(1);
  await stream.return(undefined);
  expect(capture).toHaveBeenCalledTimes(1);
});

it("preserves the old union crop geometry and pixels while rerendering on demand", async () => {
  const capture = vi.fn(render);
  const expected = tightCropRgbaFrames([render(0), render(1), render(2)]);
  const stream = streamCapturedFrames(3, capture, true);
  const first = await stream.next();
  expect(capture).toHaveBeenCalledTimes(4); // Three bounds probes, one output frame.
  expect(first.value).toEqual({ index: 0, ...expected[0] });
  expect((await stream.next()).value).toEqual({ index: 1, ...expected[1] });
  expect((await stream.next()).value).toEqual({ index: 2, ...expected[2] });
  expect((await stream.next()).done).toBe(true);
  expect(capture).toHaveBeenCalledTimes(6);
});

it("retains the full viewport for fully transparent frames", async () => {
  const frame = { pixels: new Uint8Array(16 * 16 * 4), width: 16, height: 16 };
  const result = [];
  for await (const item of streamCapturedFrames(2, () => frame, true)) result.push(item);
  expect(result).toEqual([{ index: 0, ...frame }, { index: 1, ...frame }]);
});
