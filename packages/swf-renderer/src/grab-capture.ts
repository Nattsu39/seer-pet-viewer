import {
  RenderContainer,
  RenderTexture,
  type Shader,
  type WebGLRenderer,
} from "pixi.js";

export interface SwfGrabStats {
  /** Cumulative original-submesh captures since mount. */
  captures: number;
  /** Cumulative physical pixels copied, including repeated host draws. */
  copiedPixels: number;
  /** Current player-owned RGBA8 scratch capacity; excludes host/atlas resources. */
  scratchBytes: number;
  peakScratchBytes: number;
}

/** One scratch texture per player; consumed immediately by unbatched meshes. */
export class GrabCapture {
  private texture: RenderTexture | null = null;
  private captures = 0;
  private copiedPixels = 0;
  private peakScratchBytes = 0;

  getStats(): SwfGrabStats {
    return {
      captures: this.captures,
      copiedPixels: this.copiedPixels,
      scratchBytes: this.texture
        ? this.texture.width * this.texture.height * 4
        : 0,
      peakScratchBytes: this.peakScratchBytes,
    };
  }

  instruction(shaders: Shader[]): RenderContainer {
    return new RenderContainer({
      label: "SWF grab boundary",
      render: (renderer) => this.capture(renderer as WebGLRenderer, shaders),
    });
  }

  private capture(renderer: WebGLRenderer, shaders: Shader[]): void {
    const targets = renderer.renderTarget;
    const target = targets.renderTarget;
    const width = target.pixelWidth;
    const height = target.pixelHeight;
    if (!this.texture) {
      this.texture = RenderTexture.create({
        width,
        height,
        resolution: 1,
        scaleMode: "nearest",
      });
    } else if (this.texture.width !== width || this.texture.height !== height) {
      // Keep the source alive: destroying a resource also invalidates its Pixi bind groups.
      this.texture.resize(width, height, 1);
    }
    this.peakScratchBytes = Math.max(this.peakScratchBytes, width * height * 4);

    // copyToTexture may resolve MSAA and leaves the resolve framebuffer bound.
    // Restore the actual draw attachment and its viewport before the next mesh.
    try {
      targets.copyToTexture(
        target,
        this.texture,
        { x: 0, y: 0 },
        { width, height },
        { x: 0, y: 0 },
      );
    } finally {
      targets.adaptor.startRenderPass(
        target,
        false,
        undefined,
        targets.viewport,
        targets.mipLevel,
        targets.layer,
      );
    }
    this.captures++;
    this.copiedPixels += width * height;
    for (const shader of shaders) {
      shader.resources.uGrabTexture = this.texture.source;
      shader.resources.uGrabSampler = this.texture.source.style;
      const uniforms = shader.resources.grabUniforms;
      uniforms.uniforms.uGrabSize.set([width, height]);
      uniforms.update();
    }
  }

  destroy(): void {
    this.texture?.destroy(true);
    this.texture = null;
  }
}
