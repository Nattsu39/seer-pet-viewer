import { afterEach, expect, it, vi } from "vitest";
import type { SwfClipData } from "@seer-pet-anim/swf-bundle";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  dispose: vi.fn(),
  init: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("./atlas-layout.js", () => ({
  prepareAtlasTiles: mocks.prepare,
  destroyAtlasLayout: mocks.dispose,
  releaseAtlasLayoutPixels: vi.fn(),
}));
vi.mock("pixi.js", async (load) => {
  const actual = await load<typeof import("pixi.js")>();
  return {
    ...actual,
    WebGLRenderer: class {},
    Application: class {
      init = mocks.init;
      destroy = mocks.destroy;
    },
  };
});
import { Container, WebGLRenderer } from "pixi.js";
import { SwfPlayer } from "./player.js";
const clip = {
  atlas: { width: 4, height: 4 },
  atlasWidth: 4,
  atlasHeight: 4,
  sequences: [],
} as unknown as SwfClipData;
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it.each(["abort", "destroy"])(
  "settles %s during cropping and cleans the late layout",
  async (method) => {
    let finish!: (value: unknown) => void;
    mocks.prepare.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const parent = new Container(),
      renderer = new WebGLRenderer(),
      player = new SwfPlayer(),
      controller = new AbortController();
    const mount = player.mountInto(parent, renderer, clip, {
      signal: controller.signal,
      maxTextureSize: 2,
    });
    const rejected = expect(mount).rejects.toMatchObject({
      name: "AbortError",
    });
    if (method === "abort") controller.abort();
    else player.destroy();
    await rejected;
    const layout = { tiles: [], split: true };
    finish(layout);
    await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledWith(layout));
    expect(parent.children).toHaveLength(0);
    expect(parent.destroyed).toBe(false);
    player.destroy();
    parent.destroy();
  },
);
it("cleans an Application that finishes initialization after destroy", async () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  let finish!: () => void;
  mocks.init.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const player = new SwfPlayer();
  const mount = player.mount({} as HTMLElement, clip, { clock: "manual" });
  const rejected = expect(mount).rejects.toMatchObject({ name: "AbortError" });
  player.destroy();
  await rejected;
  finish();
  await vi.waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  expect(mocks.prepare).not.toHaveBeenCalled();
});
