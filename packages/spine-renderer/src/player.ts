import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  Skeleton,
  SkeletonBinary,
  TextureAtlas,
  Vector2,
} from "@esotericsoftware/spine-core";
import {
  GLTexture,
  ManagedWebGLRenderingContext,
  ResizeMode,
  SceneRenderer,
  Vector3,
} from "@esotericsoftware/spine-webgl";
import type { SpineClipData } from "@seer/spine-bundle";
import { SPINE_PREVIEW_FPS } from "@seer/spine-bundle";
import {
  computeFittedCanvasLayout,
  finalizeExportPixels,
  mergeAlphaBounds,
  planTightExport,
  PROBE_MAX_SIDE,
  type PixelRect,
} from "@seer/anim-export/capture";

export interface SpinePlayerOptions {
  backgroundColor?: number;
}

export interface SpineCaptureOptions {
  sequence: string;
  scale: number;
  background: number | "transparent";
}

export interface SpineCapturedFrame {
  index: number;
  pixels: Uint8Array;
  width: number;
  height: number;
}

function hexToGlColor(hex: number): [number, number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return [r, g, b, 1];
}

export class SpinePlayer {
  private canvas!: HTMLCanvasElement;
  private context!: ManagedWebGLRenderingContext;
  private renderer!: SceneRenderer;
  private skeleton!: Skeleton;
  private state!: AnimationState;
  private clip: SpineClipData | null = null;
  private glTextures: GLTexture[] = [];
  private atlas: TextureAtlas | null = null;

  private playing = false;
  private loop = true;
  private frameIndex = 0;
  private frameCount = 0;
  private backgroundColor = 0x1a1a2e;

  private rafId = 0;
  private lastTime = 0;
  private onFrameChange?: (frame: number, total: number) => void;

  private fitZoom = 1;
  private userZoom = 1;
  private cameraX = 0;
  private cameraY = 0;
  private boundsOffset = new Vector2();
  private boundsSize = new Vector2();
  private resizeObserver: ResizeObserver | null = null;
  private readonly screenScratch = new Vector3();
  private readonly screenScratch2 = new Vector3();
  private exportSuspended = false;

  async mount(
    parent: HTMLElement,
    clip: SpineClipData,
    options: SpinePlayerOptions = {},
  ): Promise<void> {
    this.clip = clip;
    this.backgroundColor = options.backgroundColor ?? 0x1a1a2e;

    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.touchAction = "none";
    parent.replaceChildren(this.canvas);

    this.context = new ManagedWebGLRenderingContext(this.canvas, {
      alpha: true,
      premultipliedAlpha: true,
    });
    this.renderer = new SceneRenderer(this.canvas, this.context);
    this.renderer.skeletonRenderer.premultipliedAlpha = true;

    this.atlas = new TextureAtlas(clip.atlasText);
    for (const page of this.atlas.pages) {
      const bitmap = clip.textures.get(page.name);
      if (!bitmap) {
        throw new Error(`缺少纹理页: ${page.name}`);
      }
      page.width = bitmap.width;
      page.height = bitmap.height;
      const glTex = new GLTexture(this.context, bitmap);
      glTex.setFilters(page.minFilter, page.magFilter);
      page.setTexture(glTex);
      this.glTextures.push(glTex);
    }

    const attachmentLoader = new AtlasAttachmentLoader(this.atlas);
    const binary = new SkeletonBinary(attachmentLoader);
    binary.scale = clip.scale;
    const skeletonData = binary.readSkeletonData(clip.skeletonBytes);
    this.skeleton = new Skeleton(skeletonData);
    this.skeleton.setToSetupPose();

    const stateData = new AnimationStateData(skeletonData);
    stateData.defaultMix = clip.defaultMix;
    this.state = new AnimationState(stateData);

    const defaultAnim =
      clip.animations.find((a) => a === "await" || a === "standby") ??
      clip.animations[0] ??
      skeletonData.animations[0]?.name;
    if (defaultAnim) {
      this.setSequence(defaultAnim);
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(parent);
    this.resize();
    this.fitToView();
    this.lastTime = performance.now();
    this.tick();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.state?.clearTracks();
    this.renderer?.dispose();
    for (const tex of this.glTextures) tex.dispose();
    this.glTextures = [];
    this.atlas?.dispose();
    this.atlas = null;
    this.canvas?.remove();
    this.clip = null;
  }

  setOnFrameChange(cb: (frame: number, total: number) => void): void {
    this.onFrameChange = cb;
  }

  setBackgroundColor(color: number): void {
    this.backgroundColor = color;
  }

  setSequence(name: string): void {
    if (!this.clip) return;
    const anim =
      this.skeleton.data.findAnimation(name) ??
      this.skeleton.data.animations.find((a) => a.name === name);
    if (!anim) return;

    this.state.setAnimation(0, anim.name, this.loop);
    this.frameCount = Math.max(
      1,
      Math.ceil(anim.duration * SPINE_PREVIEW_FPS),
    );
    this.frameIndex = 0;
    this.applyPose(0);
    this.updateBounds();
    this.fitToView();
    this.emitFrame();
  }

  play(): void {
    this.playing = true;
    this.lastTime = performance.now();
  }

  pause(): void {
    this.playing = false;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    const entry = this.state.getCurrent(0);
    if (entry) entry.loop = loop;
  }

  setSpeed(speed: number): void {
    this.state.timeScale = speed;
  }

  gotoFrame(frame: number): void {
    if (!this.frameCount) return;
    this.frameIndex = Math.max(0, Math.min(frame, this.frameCount - 1));
    this.applyPose(this.frameIndex / SPINE_PREVIEW_FPS);
    this.render();
    this.emitFrame();
  }

  getSequenceFrameCount(name: string): number {
    const anim = this.skeleton?.data.findAnimation(name);
    if (!anim) return 0;
    return Math.max(1, Math.ceil(anim.duration * SPINE_PREVIEW_FPS));
  }

  getExportFps(): number {
    return SPINE_PREVIEW_FPS;
  }

  async *captureFrames(
    options: SpineCaptureOptions,
  ): AsyncGenerator<SpineCapturedFrame> {
    if (!this.clip || !this.skeleton) return;
    const anim = this.skeleton.data.findAnimation(options.sequence);
    if (!anim) return;

    const wasPlaying = this.playing;
    const savedSequence = this.state.getCurrent(0)?.animation?.name;
    const savedFrame = this.frameIndex;
    const savedBg = this.backgroundColor;
    const savedUserZoom = this.userZoom;
    const savedCameraX = this.cameraX;
    const savedCameraY = this.cameraY;
    const savedCanvasW = this.canvas.width;
    const savedCanvasH = this.canvas.height;

    this.exportSuspended = true;
    this.pause();
    if (savedSequence !== options.sequence) {
      this.setSequence(options.sequence);
    }

    const frameTotal = this.frameCount;
    const bounds = this.computeSequenceBounds(frameTotal);
    const pad = 2;
    const transparent = options.background === "transparent";

    if (transparent) {
      this.backgroundColor = 0x000000;
      this.renderWithAlphaClear = true;
    } else if (typeof options.background === "number") {
      this.backgroundColor = options.background;
      this.renderWithAlphaClear = false;
    }

    const probeLayout = computeFittedCanvasLayout(bounds, PROBE_MAX_SIDE, pad);
    this.canvas.width = probeLayout.width;
    this.canvas.height = probeLayout.height;
    this.renderer.resize(ResizeMode.Expand);
    this.applyExportCamera(bounds, probeLayout.width, probeLayout.height, pad);

    let alphaUnion: PixelRect | null = null;
    for (let i = 0; i < frameTotal; i++) {
      this.frameIndex = i;
      this.applyPose(i / SPINE_PREVIEW_FPS);
      this.renderExport();
      const probePixels = this.readExportPixels(
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

    if (!alphaUnion) {
      throw new Error("未检测到可导出的非透明像素");
    }

    const plan = planTightExport(alphaUnion, probeLayout, options.scale, pad);
    this.canvas.width = plan.renderLayout.width;
    this.canvas.height = plan.renderLayout.height;
    this.renderer.resize(ResizeMode.Expand);
    this.applyExportCamera(
      bounds,
      plan.renderLayout.width,
      plan.renderLayout.height,
      pad,
    );

    try {
      for (let i = 0; i < frameTotal; i++) {
        this.frameIndex = i;
        this.applyPose(i / SPINE_PREVIEW_FPS);
        this.renderExport();
        const renderPixels = this.readExportPixels(
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
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    } finally {
      this.renderWithAlphaClear = false;
      this.backgroundColor = savedBg;
      this.canvas.width = savedCanvasW;
      this.canvas.height = savedCanvasH;
      this.renderer.resize(ResizeMode.Expand);
      this.userZoom = savedUserZoom;
      this.cameraX = savedCameraX;
      this.cameraY = savedCameraY;
      this.updateCamera(false);
      if (savedSequence && savedSequence !== options.sequence) {
        this.setSequence(savedSequence);
      } else {
        this.frameIndex = savedFrame;
        this.applyPose(this.frameIndex / SPINE_PREVIEW_FPS);
      }
      this.render();
      this.exportSuspended = false;
      if (wasPlaying) this.play();
    }
  }

  private renderWithAlphaClear = false;

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  fitToView(): void {
    this.userZoom = 1;
    this.updateCamera(true);
  }

  enablePan(): void {
    const canvas = this.getCanvas();
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let dragCameraX = 0;
    let dragCameraY = 0;
    let pinching = false;
    let initialPinchDistance = 0;
    let initialZoom = 1;

    const endDrag = () => {
      dragging = false;
    };

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (pinching || e.button !== 0) return;
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      dragCameraX = this.cameraX;
      dragCameraY = this.cameraY;
    });
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("lostpointercapture", endDrag);
    canvas.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging || pinching) return;
      const delta = this.screenDeltaToWorld(
        e.clientX - startX,
        e.clientY - startY,
      );
      this.cameraX = dragCameraX - delta.x;
      this.cameraY = dragCameraY - delta.y;
      this.updateCamera(false);
    });
    canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        // zoom 越大视野越大；滚轮向上应放大（减小 zoom）
        const factor = e.deltaY > 0 ? 1.1 : 0.9;
        this.userZoom = Math.max(0.1, Math.min(this.userZoom * factor, 16));
        this.updateCamera(false);
      },
      { passive: false },
    );

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
        this.userZoom = Math.max(0.1, Math.min(initialZoom * scale, 16));
        this.updateCamera(false);
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

  private screenDeltaToWorld(dx: number, dy: number): { x: number; y: number } {
    const { camera } = this.renderer;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w <= 0 || h <= 0) return { x: 0, y: 0 };

    camera.update();
    const origin = this.screenScratch.set(0, 0, 0);
    const offset = this.screenScratch2.set(dx, dy, 0);
    camera.screenToWorld(origin, w, h);
    camera.screenToWorld(offset, w, h);
    return { x: offset.x - origin.x, y: offset.y - origin.y };
  }

  private applyPose(time: number): void {
    const entry = this.state.getCurrent(0);
    if (!entry) return;
    entry.trackTime = time;
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
  }

  private updateBounds(): void {
    this.skeleton.getBounds(this.boundsOffset, this.boundsSize);
  }

  private updateCamera(resetPosition: boolean): void {
    if (!this.renderer) return;
    const { camera } = this.renderer;
    const pad = 40;
    const bw = this.boundsSize.x || 1;
    const bh = this.boundsSize.y || 1;
    const availW = Math.max(1, camera.viewportWidth - pad * 2);
    const availH = Math.max(1, camera.viewportHeight - pad * 2);
    this.fitZoom = Math.max(bw / availW, bh / availH) * 1.05;
    camera.zoom = this.fitZoom * this.userZoom;

    const cx = this.boundsOffset.x + bw / 2;
    const cy = this.boundsOffset.y + bh / 2;
    if (resetPosition) {
      this.cameraX = cx;
      this.cameraY = cy;
    }
    camera.position.x = this.cameraX;
    camera.position.y = this.cameraY;
    camera.update();
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(parent.clientWidth * dpr));
    const h = Math.max(1, Math.floor(parent.clientHeight * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.renderer.resize(ResizeMode.Expand);
    this.updateCamera(false);
  }

  private emitFrame(): void {
    this.onFrameChange?.(this.frameIndex, this.frameCount);
  }

  private tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const now = performance.now();
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (this.playing) {
      this.state.update(delta);
      this.state.apply(this.skeleton);
      this.skeleton.updateWorldTransform();

      const entry = this.state.getCurrent(0);
      if (entry) {
        const nextFrame = Math.floor(entry.trackTime * SPINE_PREVIEW_FPS);
        if (nextFrame !== this.frameIndex) {
          this.frameIndex = Math.min(nextFrame, this.frameCount - 1);
          this.emitFrame();
        }
        if (!this.loop && entry.isComplete()) {
          this.playing = false;
        }
      }
    }

    if (!this.exportSuspended) {
      this.render();
    }
  };

  private computeSequenceBounds(frameTotal: number): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    const offset = new Vector2();
    const size = new Vector2();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < frameTotal; i++) {
      this.applyPose(i / SPINE_PREVIEW_FPS);
      this.skeleton.updateWorldTransform();
      this.skeleton.getBounds(offset, size);
      minX = Math.min(minX, offset.x);
      minY = Math.min(minY, offset.y);
      maxX = Math.max(maxX, offset.x + size.x);
      maxY = Math.max(maxY, offset.y + size.y);
    }
    if (!Number.isFinite(minX)) {
      return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    }
    return { minX, minY, maxX, maxY };
  }

  private applyExportCamera(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    width: number,
    height: number,
    pad = 0,
  ): void {
    const { camera } = this.renderer;
    const bw = bounds.maxX - bounds.minX || 1;
    const bh = bounds.maxY - bounds.minY || 1;
    const availW = Math.max(1, width - pad * 2);
    const availH = Math.max(1, height - pad * 2);
    this.fitZoom = Math.max(bw / availW, bh / availH);
    camera.zoom = this.fitZoom;
    this.cameraX = bounds.minX + bw / 2;
    this.cameraY = bounds.minY + bh / 2;
    camera.position.x = this.cameraX;
    camera.position.y = this.cameraY;
    camera.update();
  }

  private renderExport(): void {
    this.renderer.resize(ResizeMode.Expand);
    const gl = this.context.gl;
    if (this.renderWithAlphaClear) {
      gl.clearColor(0, 0, 0, 0);
    } else {
      const [r, g, b, a] = hexToGlColor(this.backgroundColor);
      gl.clearColor(r, g, b, a);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.renderer.begin();
    this.renderer.drawSkeleton(this.skeleton, true);
    this.renderer.end();
  }

  private readExportPixels(width: number, height: number): Uint8Array {
    const gl = this.context.gl;
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const rowBytes = width * 4;
    const out = new Uint8Array(raw.length);
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * rowBytes;
      out.set(raw.subarray(srcRow, srcRow + rowBytes), y * rowBytes);
    }
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3]! / 255;
      if (a <= 0) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        continue;
      }
      if (a >= 1) continue;
      out[i] = Math.min(255, Math.round(out[i]! / a));
      out[i + 1] = Math.min(255, Math.round(out[i + 1]! / a));
      out[i + 2] = Math.min(255, Math.round(out[i + 2]! / a));
    }
    return out;
  }

  private render(): void {
    this.renderer.resize(ResizeMode.Expand);
    this.updateCamera(false);

    const gl = this.context.gl;
    const [r, g, b, a] = hexToGlColor(this.backgroundColor);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.renderer.begin();
    this.renderer.drawSkeleton(this.skeleton, true);
    this.renderer.end();
  }
}
