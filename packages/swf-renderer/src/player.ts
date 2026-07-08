import {
  Application,
  Container,
  Geometry,
  Mesh,
  RenderTexture,
  Shader,
  Texture,
  WebGLRenderer,
} from "pixi.js";
import {
  capLayoutVertexBounds,
  computeReferenceScale,
  planReferenceExport,
  resolveReferenceSequence,
  tightCropRgbaFrames,
} from "@seer/anim-export/capture";
import { readRenderTexturePixels } from "./read-render-texture-pixels.js";
import type {
  SwfClipData,
  SwfFrame,
  SwfSequence,
  SwfSubMesh,
} from "@seer/swf-bundle";
import {
  computeSequenceVertexBounds,
  insetQuadUvs,
  isSwfContentLayer,
} from "@seer/swf-bundle";
import {
  materialToPixiBlend,
  needsGrabPass,
  needsStencilTest,
  isMaskClearer,
  isMaskWriter,
} from "./blend.js";
import { grabModeId } from "./shaders.js";
import { createSwfShader, updateSwfShaderResources } from "./swf-shader.js";

export interface SwfPlayerOptions {
  backgroundColor?: number;
  tint?: [number, number, number, number];
}

export interface SwfCaptureOptions {
  sequence: string;
  scale: number;
  background: number | "transparent";
  /** 与 pet_export.py RENDER_FX_LAYERS 对应，默认不渲染 add 特效层 */
  renderFxLayers?: boolean;
}

export interface SwfCapturedFrame {
  index: number;
  pixels: Uint8Array;
  width: number;
  height: number;
}

type MeshRole = "content" | "mask";

/**
 * 若图集任一维度超过设备 MAX_TEXTURE_SIZE，用 canvas bilinear 降采样到上限内。
 * UV 是归一化 [0,1]，降采样后无需改 UV / shader / mesh。
 * 仅缩超限维度，尽量保真。降采样后释放原图。
 */
async function ensureAtlasFitsMaxTextureSize(
  bitmap: ImageBitmap,
  maxDim: number,
): Promise<ImageBitmap> {
  const { width, height } = bitmap;
  if (width <= maxDim && height <= maxDim) return bitmap;

  const newWidth = Math.min(width, maxDim);
  const newHeight = Math.min(height, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return bitmap;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);

  const result = await createImageBitmap(canvas, {
    premultiplyAlpha: "none",
  });
  bitmap.close();
  return result;
}

export class SwfPlayer {
  private app!: Application;
  private root = new Container();
  private stage = new Container();
  private texture!: Texture;
  private atlasBitmap: ImageBitmap | null = null;
  private clip: SwfClipData | null = null;
  private sequence: SwfSequence | null = null;
  private frameIndex = 0;
  private playing = false;
  private loop = true;
  private speed = 1;
  private accumulator = 0;
  private tint: [number, number, number, number] = [1, 1, 1, 1];
  private grabTexture: RenderTexture | null = null;
  private meshes: Mesh<Geometry, Shader>[] = [];
  private shaders: {
    normal: Shader | null;
    grab: Shader | null;
    mask: Shader | null;
  } = {
    normal: null,
    grab: null,
    mask: null,
  };
  private bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private fitScale = 1;
  private userZoom = 1;
  private onFrameChange?: (frame: number, total: number) => void;

  async mount(
    parent: HTMLElement,
    clip: SwfClipData,
    options: SwfPlayerOptions = {},
  ): Promise<void> {
    this.clip = clip;
    this.tint = options.tint ?? [1, 1, 1, 1];

    this.app = new Application();
    await this.app.init({
      resizeTo: parent,
      background: options.backgroundColor ?? 0x1a1a2e,
      antialias: true,
      preferWebGLVersion: 2,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: "webgl",
    });
    parent.appendChild(this.app.canvas);

    // 查询设备 WebGL 最大纹理尺寸，降采样超限图集避免移动端黑方块
    const gl = (this.app.renderer as WebGLRenderer).gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    this.atlasBitmap = await ensureAtlasFitsMaxTextureSize(
      clip.atlas,
      maxTextureSize,
    );
    this.texture = Texture.from(this.atlasBitmap);
    this.texture.source.scaleMode = "nearest";
    // 直通 alpha 图集 + shader 直通输出 → Pixi 使用 normal-npm 混合（等价于 pet_export PMA over）
    this.texture.source.alphaMode = "no-premultiply-alpha";

    this.root.addChild(this.stage);
    this.app.stage.addChild(this.root);

    this.shaders.normal = createSwfShader(
      this.texture,
      false,
      this.tint,
      clip.atlasWidth,
      clip.atlasHeight,
    );
    this.shaders.grab = createSwfShader(
      this.texture,
      true,
      this.tint,
      clip.atlasWidth,
      clip.atlasHeight,
    );
    this.shaders.mask = createSwfShader(
      this.texture,
      false,
      this.tint,
      clip.atlasWidth,
      clip.atlasHeight,
      true,
    );

    this.setSequence(clip.sequences[0]?.name ?? "standby");
    requestAnimationFrame(() => this.fitToView());
    this.app.renderer.on("resize", () => {
      this.fitToView();
      this.syncGrabTextureToRenderer();
    });

    this.app.ticker.add((ticker) => {
      if (!this.playing || !this.sequence) return;
      this.accumulator += (ticker.deltaMS / 1000) * this.speed;
      const frameDuration = 1 / (this.clip?.frameRate ?? 24);
      while (this.accumulator >= frameDuration) {
        this.accumulator -= frameDuration;
        this.advanceFrame();
      }
    });
  }

  destroy(): void {
    this.shaders.normal?.destroy();
    this.shaders.grab?.destroy();
    this.shaders.mask?.destroy();
    this.shaders = { normal: null, grab: null, mask: null };
    this.app?.destroy(true, { children: true });
    this.atlasBitmap?.close();
    this.atlasBitmap = null;
  }

  setOnFrameChange(cb: (frame: number, total: number) => void): void {
    this.onFrameChange = cb;
  }

  setBackgroundColor(color: number): void {
    if (!this.app?.renderer) return;
    this.app.renderer.background.color = color;
  }

  setSequence(name: string): void {
    if (!this.clip) return;
    const seq = this.clip.sequences.find((s) => s.name === name);
    if (!seq) return;
    this.sequence = seq;
    this.frameIndex = 0;
    this.accumulator = 0;
    this.renderCurrentFrame();
    this.fitToView();
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  gotoFrame(frame: number): void {
    if (!this.sequence) return;
    this.frameIndex = Math.max(
      0,
      Math.min(frame, this.sequence.frames.length - 1),
    );
    this.renderCurrentFrame();
  }

  getFrameIndex(): number {
    return this.frameIndex;
  }

  getFrameCount(): number {
    return this.sequence?.frames.length ?? 0;
  }

  getSequenceFrameCount(name: string): number {
    const seq = this.clip?.sequences.find((s) => s.name === name);
    return seq?.frames.length ?? 0;
  }

  getExportFps(): number {
    return this.clip?.frameRate ?? 24;
  }

  async *captureFrames(
    options: SwfCaptureOptions,
  ): AsyncGenerator<SwfCapturedFrame> {
    if (!this.clip || !this.app) return;
    const seq = this.clip.sequences.find((s) => s.name === options.sequence);
    if (!seq?.frames.length) return;

    const wasPlaying = this.playing;
    const savedSequence = this.sequence?.name;
    const savedFrame = this.frameIndex;
    const savedUserZoom = this.userZoom;
    const savedRootPos = { x: this.root.position.x, y: this.root.position.y };
    const savedRootScale = { x: this.root.scale.x, y: this.root.scale.y };
    const savedBgColor = this.app.renderer.background.color;
    const savedBgAlpha = this.app.renderer.background.alpha;

    this.pause();
    if (this.sequence?.name !== options.sequence) {
      this.setSequence(options.sequence);
    }

    const refName = resolveReferenceSequence(
      this.clip.sequences.map((s) => s.name),
    );
    const refSeq = this.clip.sequences.find((s) => s.name === refName);
    if (!refSeq?.frames.length) return;

    const renderFxLayers = options.renderFxLayers ?? true;

    const refScale = computeReferenceScale(
      computeSequenceVertexBounds(refSeq),
    );
    const layoutBounds = capLayoutVertexBounds(
      computeSequenceVertexBounds(seq),
    );
    const layout = planReferenceExport(
      layoutBounds,
      refScale,
      options.scale,
    );
    const transparent = options.background === "transparent";

    const exportRT = RenderTexture.create({
      width: layout.width,
      height: layout.height,
      resolution: 1,
    });
    if (transparent) {
      this.app.renderer.background.alpha = 0;
      this.app.renderer.background.color = 0;
    } else {
      this.app.renderer.background.alpha = 1;
      this.app.renderer.background.color = options.background;
    }
    this.resizeGrabTexture(layout.width, layout.height);

    const rendered: {
      index: number;
      pixels: Uint8Array;
      width: number;
      height: number;
    }[] = [];

    try {
      for (let i = 0; i < seq.frames.length; i++) {
        try {
          this.frameIndex = i;
          this.applyExportTransform(
            layoutBounds,
            layout.width,
            layout.height,
            layout.pixelsPerUnitX,
            layout.pixelsPerUnitY,
          );
          this.renderCurrentFrameMeshes({ renderFxLayers });
          this.app.renderer.render({
            container: this.app.stage,
            target: exportRT,
            clear: true,
          });
          const pixels = readRenderTexturePixels(
            this.app,
            exportRT,
            layout.width,
            layout.height,
          );
          rendered.push({
            index: i,
            pixels,
            width: layout.width,
            height: layout.height,
          });
        } catch (e) {
          throw new Error(
            `导出第 ${i + 1}/${seq.frames.length} 帧失败: ${e instanceof Error ? e.message : e}`,
            { cause: e },
          );
        }
      }
    } finally {
      exportRT.destroy(true);
    }

    if (!rendered.length) {
      throw new Error("未检测到可导出的帧");
    }

    const cropped = tightCropRgbaFrames(rendered);

    try {
      for (let i = 0; i < cropped.length; i++) {
        const frame = cropped[i]!;
        yield {
          index: rendered[i]!.index,
          pixels: frame.pixels,
          width: frame.width,
          height: frame.height,
        };
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    } finally {
      this.app.renderer.background.color = savedBgColor;
      this.app.renderer.background.alpha = savedBgAlpha;
      if (savedSequence && savedSequence !== options.sequence) {
        this.setSequence(savedSequence);
      } else {
        this.frameIndex = savedFrame;
        this.renderCurrentFrame();
      }
      this.userZoom = savedUserZoom;
      this.root.position.set(savedRootPos.x, savedRootPos.y);
      this.root.scale.set(savedRootScale.x, savedRootScale.y);
      this.applyTransform(false);
      if (wasPlaying) this.play();
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  fitToView(): void {
    if (!this.app) return;
    this.userZoom = 1;
    const pad = 40;
    const bw = this.bounds.maxX - this.bounds.minX || 1;
    const bh = this.bounds.maxY - this.bounds.minY || 1;
    const sx = (this.app.screen.width - pad * 2) / bw;
    const sy = (this.app.screen.height - pad * 2) / bh;
    this.fitScale = Math.min(sx, sy);
    this.applyTransform(true);
  }

  private applyTransform(resetPosition = false): void {
    if (!this.app) return;
    const scale = this.fitScale * this.userZoom;
    this.root.scale.set(scale, -scale);
    if (!resetPosition) return;
    const cx = (this.bounds.minX + this.bounds.maxX) / 2;
    const cy = (this.bounds.minY + this.bounds.maxY) / 2;
    this.root.position.set(
      this.app.screen.width / 2 - cx * scale,
      this.app.screen.height / 2 + cy * scale,
    );
  }

  setZoom(zoom: number): void {
    this.userZoom = Math.max(0.1, Math.min(zoom, 16));
    this.applyTransform(false);
  }

  getZoom(): number {
    return this.userZoom;
  }

  enablePan(): void {
    const canvas = this.getCanvas();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    canvas.addEventListener("pointerup", () => {
      dragging = false;
    });
    canvas.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      this.root.x += e.clientX - lastX;
      this.root.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        this.setZoom(this.userZoom * factor);
      },
      { passive: false },
    );
  }

  private advanceFrame(): void {
    if (!this.sequence) return;
    const total = this.sequence.frames.length;
    let next = this.frameIndex + 1;
    if (next >= total) {
      if (!this.loop) {
        this.playing = false;
        return;
      }
      next = 0;
    }
    this.frameIndex = next;
    this.renderCurrentFrame();
  }

  private renderCurrentFrame(): void {
    this.renderCurrentFrameMeshes();
    this.onFrameChange?.(this.frameIndex, this.sequence!.frames.length);
    this.app?.render();
  }

  private renderCurrentFrameMeshes(options?: {
    renderFxLayers?: boolean;
  }): void {
    if (!this.sequence) return;
    const frame = this.sequence.frames[this.frameIndex];
    if (!frame) return;
    this.updateBounds(frame);
    this.clearMeshes();
    this.renderFrame(frame, options);
  }

  private updateBounds(frame: SwfFrame): void {
    const pos = frame.mesh.positions;
    if (pos.length < 2) return;
    let minX = pos[0]!;
    let maxX = pos[0]!;
    let minY = pos[1]!;
    let maxY = pos[1]!;
    for (let i = 0; i < pos.length; i += 2) {
      minX = Math.min(minX, pos[i]!);
      maxX = Math.max(maxX, pos[i]!);
      minY = Math.min(minY, pos[i + 1]!);
      maxY = Math.max(maxY, pos[i + 1]!);
    }
    this.bounds = { minX, minY, maxX, maxY };
  }

  private clearMeshes(): void {
    for (const child of [...this.stage.children]) {
      child.destroy({ children: true });
    }
    this.meshes = [];
  }

  private renderFrame(
    frame: SwfFrame,
    options?: { renderFxLayers?: boolean },
  ): void {
    const renderFx = options?.renderFxLayers ?? true;
    const subMeshes = frame.mesh.subMeshes;
    for (let i = 0; i < subMeshes.length; ) {
      const subMesh = subMeshes[i]!;
      const material = subMesh.material;

      try {
        if (isMaskWriter(material)) {
          if (!renderFx && !isSwfContentLayer(subMesh)) {
            i++;
            while (
              i < subMeshes.length &&
              needsStencilTest(subMeshes[i]!.material)
            ) {
              i++;
            }
            if (i < subMeshes.length && isMaskClearer(subMeshes[i]!.material)) {
              i++;
            }
            continue;
          }

          const maskMesh = this.buildSubMeshMesh(frame, subMesh, "mask");
          i++;

          const contentMeshes: Mesh<Geometry, Shader>[] = [];
          while (
            i < subMeshes.length &&
            needsStencilTest(subMeshes[i]!.material)
          ) {
            const masked = subMeshes[i]!;
            if (needsGrabPass(masked.material)) this.snapshotGrab();
            contentMeshes.push(this.buildSubMeshMesh(frame, masked, "content"));
            i++;
          }

          if (i < subMeshes.length && isMaskClearer(subMeshes[i]!.material)) {
            i++;
          }

          if (contentMeshes.length > 0) {
            const clipped = new Container();
            clipped.addChild(maskMesh);
            clipped.setMask({
              mask: maskMesh,
              inverse: false,
              channel: "alpha",
            });
            for (const contentMesh of contentMeshes) {
              clipped.addChild(contentMesh);
              this.meshes.push(contentMesh);
            }
            this.meshes.push(maskMesh);
            this.stage.addChild(clipped);
          }
          continue;
        }

        if (isMaskClearer(material) || needsStencilTest(material)) {
          i++;
          continue;
        }

        if (!renderFx && !isSwfContentLayer(subMesh)) {
          i++;
          continue;
        }

        if (needsGrabPass(material)) {
          this.snapshotGrab();
        }

        const mesh = this.buildSubMeshMesh(frame, subMesh, "content");
        this.stage.addChild(mesh);
        this.meshes.push(mesh);
        i++;
      } catch (e) {
        throw new Error(
          `渲染 submesh ${i}（${material.shaderKind}）失败: ${e instanceof Error ? e.message : e}`,
          { cause: e },
        );
      }
    }
  }

  private buildSubMeshMesh(
    frame: SwfFrame,
    subMesh: SwfSubMesh,
    role: MeshRole,
  ): Mesh<Geometry, Shader> {
    const material = subMesh.material;
    const mask = role === "mask";
    const grab = !mask && needsGrabPass(material);

    const start = subMesh.startVertex;
    const vertCount = (subMesh.indexCount / 6) * 4;
    const positions: number[] = [];
    const uvs: number[] = [];
    const mulColors: number[] = [];
    const addColors: number[] = [];

    for (let vi = start; vi < start + vertCount; vi++) {
      positions.push(
        frame.mesh.positions[vi * 2]!,
        frame.mesh.positions[vi * 2 + 1]!,
      );
      uvs.push(frame.mesh.uvs[vi * 2]!, frame.mesh.uvs[vi * 2 + 1]!);
      mulColors.push(
        frame.mesh.mulColors[vi * 4]!,
        frame.mesh.mulColors[vi * 4 + 1]!,
        frame.mesh.mulColors[vi * 4 + 2]!,
        frame.mesh.mulColors[vi * 4 + 3]!,
      );
      addColors.push(
        frame.mesh.addColors[vi * 4]!,
        frame.mesh.addColors[vi * 4 + 1]!,
        frame.mesh.addColors[vi * 4 + 2]!,
        frame.mesh.addColors[vi * 4 + 3]!,
      );
    }

    const indices: number[] = [];
    for (let j = 0; j < subMesh.indexCount; j++) {
      indices.push(frame.mesh.indices[subMesh.indexStart + j]! - start);
    }

    if (this.clip) {
      const quadCount = vertCount / 4;
      for (let q = 0; q < quadCount; q++) {
        insetQuadUvs(uvs, q * 8, this.clip.atlasWidth, this.clip.atlasHeight);
      }
    }

    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: new Float32Array(positions), size: 2 },
        aUV: { buffer: new Float32Array(uvs), size: 2 },
        aMulColor: { buffer: new Float32Array(mulColors), size: 4 },
        aAddColor: { buffer: new Float32Array(addColors), size: 4 },
        ...(grab
          ? {
              aGrabMode: {
                buffer: new Float32Array(vertCount).fill(
                  grabModeId(material.grabBlend),
                ),
                size: 1,
              },
            }
          : {}),
      },
      indexBuffer: new Uint16Array(indices),
    });

    const shader = mask
      ? this.shaders.mask!
      : grab
        ? this.shaders.grab!
        : this.shaders.normal!;

    updateSwfShaderResources(
      shader,
      this.texture,
      this.tint,
      this.clip!.atlasWidth,
      this.clip!.atlasHeight,
      mask,
    );

    const mesh = new Mesh({
      geometry,
      shader,
      texture: this.texture,
    }) as Mesh<Geometry, Shader>;

    if (!mask) {
      mesh.blendMode = (
        grab ? "normal" : materialToPixiBlend(material).blendMode
      ) as never;
    }

    return mesh;
  }

  private recreateGrabShader(): void {
    if (!this.clip) return;
    this.shaders.grab?.destroy();
    this.shaders.grab = createSwfShader(
      this.texture,
      true,
      this.tint,
      this.clip.atlasWidth,
      this.clip.atlasHeight,
      false,
      this.grabTexture?.source ?? null,
    );
  }

  private syncGrabTextureToRenderer(): void {
    if (!this.app?.renderer) return;
    const w = Math.max(1, this.app.renderer.width);
    const h = Math.max(1, this.app.renderer.height);
    this.resizeGrabTexture(w, h);
  }

  private ensureGrabTexture(): RenderTexture {
    this.syncGrabTextureToRenderer();
    return this.grabTexture!;
  }

  private resizeGrabTexture(width: number, height: number): void {
    if (
      this.grabTexture &&
      (this.grabTexture.width !== width || this.grabTexture.height !== height)
    ) {
      this.grabTexture.destroy(true);
      this.grabTexture = null;
    }
    if (!this.grabTexture) {
      this.grabTexture = this.createGrabTexture(width, height);
      this.recreateGrabShader();
    }
  }

  private createGrabTexture(width: number, height: number): RenderTexture {
    const rt = RenderTexture.create({ width, height });
    rt.source.scaleMode = "nearest";
    rt.source.alphaMode = "no-premultiply-alpha";
    return rt;
  }

  private applyExportTransform(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    width: number,
    height: number,
    pixelsPerUnitX: number,
    pixelsPerUnitY: number,
  ): void {
    // 预览用负 Y 适配屏幕；导出到纹理时用正 Y，配合 readPixels 翻转后与预览朝向一致
    this.root.scale.set(pixelsPerUnitX, pixelsPerUnitY);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.root.position.set(
      width / 2 - cx * pixelsPerUnitX,
      height / 2 - cy * pixelsPerUnitY,
    );
  }

  private snapshotGrab(): void {
    const rt = this.ensureGrabTexture();
    this.app.renderer.render({
      container: this.app.stage,
      target: rt,
      clear: true,
    });
  }
}
