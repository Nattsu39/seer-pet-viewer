import type { Application, RenderTexture } from "pixi.js";
import { unpremultiplyPixels } from "@seer-pet-anim/anim-export/capture";
import { copyRgbaPixels } from "./copy-rgba.js";

type GlExportRenderer = Application["renderer"] & {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  renderTarget: {
    getRenderTarget(texture: RenderTexture): unknown;
    getGpuRenderTarget(target: unknown): {
      resolveTargetFramebuffer: WebGLFramebuffer;
    };
  };
};

/** 读取紧凑 RGBA；WebGL 路径翻转行并还原为编码器需要的直通 alpha。 */
export function readRenderTexturePixels(
  app: Application,
  target: RenderTexture,
  width: number,
  height: number,
): Uint8Array {
  const renderer = app.renderer as GlExportRenderer;
  if (!renderer.gl?.readPixels) {
    const extracted = app.renderer.extract.pixels({ target });
    return copyRgbaPixels(extracted.pixels, extracted.width, extracted.height);
  }

  const renderTarget = renderer.renderTarget.getRenderTarget(target);
  const glTarget = renderer.renderTarget.getGpuRenderTarget(renderTarget) as {
    resolveTargetFramebuffer: WebGLFramebuffer;
  };
  const gl = renderer.gl;
  const raw = new Uint8Array(width * height * 4);

  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.FRAMEBUFFER, glTarget.resolveTargetFramebuffer);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);

  const rowBytes = width * 4;
  const out = new Uint8Array(raw.length);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowBytes;
    out.set(raw.subarray(srcRow, srcRow + rowBytes), y * rowBytes);
  }
  unpremultiplyPixels(out);
  return out;
}
