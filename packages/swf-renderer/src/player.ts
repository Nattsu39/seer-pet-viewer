import {
  Application,
  Container,
  Geometry,
  Mesh,
  RenderTexture,
  Shader,
  Texture,
} from "pixi.js";
import {
  computeFittedCanvasLayout,
  finalizeExportPixels,
  mergeAlphaBounds,
  planTightExport,
  PROBE_MAX_SIDE,
  type PixelRect,
} from "@seer/anim-export/capture";
import { readRenderTexturePixels } from "./read-render-texture-pixels.js";
import type {
  SwfClipData,
  SwfFrame,
  SwfSequence,
  SwfSubMesh,
} from "@seer/swf-bundle";
import { insetQuadUvs } from "@seer/swf-bundle";
import {
  materialToPixiBlend,
  needsGrabPass,
  needsStencilTest,
  isMaskClearer,
  isMaskWriter,
} from "./blend.js";
import { createSwfShader, updateSwfShaderResources } from "./swf-shader.js";

export interface SwfPlayerOptions {
  backgroundColor?: number;
  tint?: [number, number, number, number];
}

export interface SwfCaptureOptions {
  sequence: string;
  scale: number;
  background: number | "transparent";
}

export interface SwfCapturedFrame {
  index: number;
  pixels: Uint8Array;
  width: number;
  height: number;
}

type MeshRole = "content" | "mask";

export class SwfPlayer {
  private app!: Application;
  private root = new Container();
  private stage = new Container();
  private texture!: Texture;
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
    this.texture = Texture.from(clip.atlas);
    this.texture.source.scaleMode = "nearest";
    // 直通 alpha 图集 + shader 直通输出 → Pixi 使用 normal-npm 混合（等价于 pet_export PMA over）
    this.texture.source.alphaMode = "no-premultiply-alpha";

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
    this.app.renderer.on("resize", () => this.fitToView());

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
    this.clip?.atlas.close();
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

    const positionBounds = this.computeSequenceBounds(seq);
    const pad = 2;
    const transparent = options.background === "transparent";
    const probeLayout = computeFittedCanvasLayout(
      positionBounds,
      PROBE_MAX_SIDE,
      pad,
    );

    const probeRT = RenderTexture.create({
      width: probeLayout.width,
      height: probeLayout.height,
      resolution: 1,
    });
    if (transparent) {
      this.app.renderer.background.alpha = 0;
      this.app.renderer.background.color = 0;
    } else {
      this.app.renderer.background.alpha = 1;
      this.app.renderer.background.color = options.background;
    }
    this.resizeGrabTexture(probeLayout.width, probeLayout.height);

    let alphaUnion: PixelRect | null = null;

    try {
      for (let i = 0; i < seq.frames.length; i++) {
        this.frameIndex = i;
        this.applyExportTransform(
          positionBounds,
          probeLayout.width,
          probeLayout.height,
          probeLayout.pixelsPerUnitX,
          probeLayout.pixelsPerUnitY,
        );
        this.renderCurrentFrameMeshes();
        this.app.renderer.render({
          container: this.app.stage,
          target: probeRT,
          clear: true,
        });
        const probePixels = readRenderTexturePixels(
          this.app,
          probeRT,
          probeLayout.width,
          probeLayout.height,
        );
        alphaUnion = mergeAlphaBounds(
          probePixels,
          probeLayout.width,
          probeLayout.height,
          alphaUnion,
          transparent,
        );
      }
    } finally {
      probeRT.destroy(true);
    }

    if (!alphaUnion) {
      throw new Error("未检测到可导出的非透明像素");
    }

    const plan = planTightExport(alphaUnion, probeLayout, options.scale, pad);

    const exportRT = RenderTexture.create({
      width: plan.renderLayout.width,
      height: plan.renderLayout.height,
      resolution: 1,
    });
    this.resizeGrabTexture(plan.renderLayout.width, plan.renderLayout.height);

    try {
      for (let i = 0; i < seq.frames.length; i++) {
        this.frameIndex = i;
        this.applyExportTransform(
          positionBounds,
          plan.renderLayout.width,
          plan.renderLayout.height,
          plan.renderLayout.pixelsPerUnitX,
          plan.renderLayout.pixelsPerUnitY,
        );
        this.renderCurrentFrameMeshes();
        this.app.renderer.render({
          container: this.app.stage,
          target: exportRT,
          clear: true,
        });

        const renderPixels = readRenderTexturePixels(
          this.app,
          exportRT,
          plan.renderLayout.width,
          plan.renderLayout.height,
        );
        yield {
          index: i,
          pixels: finalizeExportPixels(
            renderPixels,
            plan.renderLayout.width,
            plan.renderLayout.height,
            plan,
            pad,
          ),
          width: plan.exportWidth,
          height: plan.exportHeight,
        };
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
    } finally {
      exportRT.destroy(true);
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
    let pinching = false;
    let initialPinchDistance = 0;
    let initialZoom = 1;

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (pinching) return; // Disable drag during pinch
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    canvas.addEventListener("pointerup", () => {
      dragging = false;
    });
    canvas.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging || pinching) return;
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

    // Mobile pinch-to-zoom
    canvas.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        if (e.touches.length === 2) {
          pinching = true;
          initialPinchDistance = getTouchDistance(e.touches[0], e.touches[1]);
          initialZoom = this.userZoom;
        }
      },
      { passive: false },
    );

    canvas.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        if (!pinching || e.touches.length !== 2) return;
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
        const scale = currentDistance / initialPinchDistance;
        this.setZoom(initialZoom * scale);
      },
      { passive: false },
    );

    canvas.addEventListener("touchend", () => {
      pinching = false;
    });

    function getTouchDistance(t1: Touch, t2: Touch): number {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
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

  private renderCurrentFrameMeshes(): void {
    if (!this.sequence) return;
    const frame = this.sequence.frames[this.frameIndex];
    if (!frame) return;
    this.updateBounds(frame);
    this.clearMeshes();
    this.renderFrame(frame);
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

  private renderFrame(frame: SwfFrame): void {
    const subMeshes = frame.mesh.subMeshes;
    for (let i = 0; i < subMeshes.length; ) {
      const material = subMeshes[i]!.material;

      if (isMaskWriter(material)) {
        const maskMesh = this.buildSubMeshMesh(frame, subMeshes[i]!, "mask");
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

      const mesh = this.buildSubMeshMesh(frame, subMeshes[i]!, "content");
      this.stage.addChild(mesh);
      this.meshes.push(mesh);
      i++;
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
      grab,
      this.clip!.atlasWidth,
      this.clip!.atlasHeight,
      material.grabBlend,
      grab ? this.ensureGrabTexture() : undefined,
      mask,
    );

    const mesh = new Mesh({
      geometry,
      shader,
      texture: this.texture,
    }) as Mesh<Geometry, Shader>;

    if (!mask) {
      mesh.blendMode = materialToPixiBlend(material).blendMode as never;
    }

    return mesh;
  }

  private ensureGrabTexture(): RenderTexture {
    if (!this.grabTexture) {
      this.grabTexture = this.createGrabTexture(
        Math.max(1, this.app.screen.width),
        Math.max(1, this.app.screen.height),
      );
    }
    return this.grabTexture;
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
    }
  }

  private createGrabTexture(width: number, height: number): RenderTexture {
    const rt = RenderTexture.create({ width, height });
    rt.source.scaleMode = "nearest";
    rt.source.alphaMode = "no-premultiply-alpha";
    return rt;
  }

  private computeSequenceBounds(seq: SwfSequence): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const frame of seq.frames) {
      const pos = frame.mesh.positions;
      for (let i = 0; i < pos.length; i += 2) {
        minX = Math.min(minX, pos[i]!);
        maxX = Math.max(maxX, pos[i]!);
        minY = Math.min(minY, pos[i + 1]!);
        maxY = Math.max(maxY, pos[i + 1]!);
      }
    }
    if (!Number.isFinite(minX)) {
      return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    }
    return { minX, minY, maxX, maxY };
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
