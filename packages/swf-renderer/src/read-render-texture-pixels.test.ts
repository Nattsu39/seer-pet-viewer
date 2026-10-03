import { describe, expect, it, vi } from "vitest";
import type { Application, RenderTexture } from "pixi.js";
import { readRenderTexturePixels } from "./read-render-texture-pixels.js";

function createWebGlApp(pixels: Uint8Array) {
  const previousFramebuffer = {};
  const exportFramebuffer = {};
  const gl = {
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_BINDING: 0x8ca6,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    getParameter: vi.fn(() => previousFramebuffer),
    bindFramebuffer: vi.fn(),
    readPixels: vi.fn(
      (
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        _format: number,
        _type: number,
        output: Uint8Array,
      ) => output.set(pixels),
    ),
  };
  const app = {
    renderer: {
      gl,
      renderTarget: {
        getRenderTarget: vi.fn(() => ({})),
        getGpuRenderTarget: vi.fn(() => ({
          resolveTargetFramebuffer: exportFramebuffer,
        })),
      },
    },
  } as unknown as Application;
  return { app, gl, previousFramebuffer, exportFramebuffer };
}

describe("readRenderTexturePixels", () => {
  const target = {} as RenderTexture;

  it("returns straight-alpha colors and flips WebGL rows for image encoding", () => {
    const { app, gl, previousFramebuffer, exportFramebuffer } = createWebGlApp(
      new Uint8Array([40, 20, 10, 128, 30, 60, 90, 255]),
    );

    const pixels = readRenderTexturePixels(app, target, 1, 2);

    expect(Array.from(pixels)).toEqual([30, 60, 90, 255, 80, 40, 20, 128]);
    expect(pixels.buffer.byteLength).toBe(8);
    expect(gl.bindFramebuffer.mock.calls).toEqual([
      [gl.FRAMEBUFFER, exportFramebuffer],
      [gl.FRAMEBUFFER, previousFramebuffer],
    ]);
  });

  it("clears invisible RGB and preserves opaque colors", () => {
    const { app } = createWebGlApp(
      new Uint8Array([20, 40, 60, 0, 20, 40, 60, 255]),
    );

    expect(Array.from(readRenderTexturePixels(app, target, 2, 1))).toEqual([
      0, 0, 0, 0, 20, 40, 60, 255,
    ]);
  });

  it("copies the extract fallback without applying a second alpha conversion", () => {
    const buffer = new Uint8ClampedArray([
      9, 9, 9, 9, 80, 40, 20, 128, 9, 9, 9, 9,
    ]);
    const extracted = buffer.subarray(4, 8);
    const extract = vi.fn(() => ({ pixels: extracted, width: 1, height: 1 }));
    const app = {
      renderer: { extract: { pixels: extract } },
    } as unknown as Application;

    const pixels = readRenderTexturePixels(app, target, 1, 1);

    expect(Array.from(pixels)).toEqual([80, 40, 20, 128]);
    expect(pixels.buffer.byteLength).toBe(4);
    expect(pixels.buffer).not.toBe(buffer.buffer);
    expect(Array.from(extracted)).toEqual([80, 40, 20, 128]);
    expect(extract).toHaveBeenCalledWith({ target });
  });
});
