<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed, nextTick } from "vue";
import ExportModal from "./ExportModal.vue";
import { useHistoryOverlay } from "../composables/useHistoryOverlay";
import { SwfPlayer } from "@seer/swf-renderer";
import { SpinePlayer } from "@seer/spine-renderer";
import type { SwfClipData } from "@seer/swf-bundle";
import { getEffectiveSwfMaxTextureSize } from "../lib/swf-texture";
import type { SpineClipData } from "@seer/spine-bundle";
import type { FrameCaptureSource } from "@seer/anim-export";
import type { PetClip } from "../composables/usePetLoader";
import type { ToolbarPosition } from "../composables/useViewerSettings";
import {
  getCanvasBackgroundColor,
  useViewerSettings,
} from "../composables/useViewerSettings";
import { useAnimationExport } from "../composables/useAnimationExport";
import { getAnimationLabel } from "../lib/animation-labels";
import { installSwfBaselineHarness } from "../lib/swf-baseline-harness";

const props = withDefaults(
  defineProps<{
    pet: PetClip;
    toolbarPosition?: ToolbarPosition;
    isMobile?: boolean;
  }>(),
  { toolbarPosition: "bottom", isMobile: false },
);

const emit = defineEmits<{
  frameChange: [frame: number, total: number];
  fpsUpdate: [fps: number];
}>();

const { resolvedTheme } = useViewerSettings();
const {
  exporting,
  exportError,
  exportProgress,
  exportFormat,
  exportScale,
  exportBackground,
  runExport,
} = useAnimationExport();

const canvasHost = ref<HTMLElement | null>(null);
const swfPlayer = ref<SwfPlayer | null>(null);
const spinePlayer = ref<SpinePlayer | null>(null);
const currentSequence = ref("");
const playing = ref(true);
const loop = ref(true);
const speed = ref(1);
const currentFrame = ref(0);
const frameCount = ref(0);
const controlsCollapsed = ref(false);
const showExportModal = ref(false);
const { openOverlay: openExportModal, closeOverlay: closeExportModal } =
  useHistoryOverlay(showExportModal, "export-modal");

const sequenceOptions = computed(() => {
  if (props.pet.type === "swf") {
    return props.pet.clip.sequences.map((s) => ({
      value: s.name,
      label: getAnimationLabel(s.name),
      frames: s.frames.length,
    }));
  }
  return props.pet.clip.animations.map((name) => ({
    value: name,
    label: getAnimationLabel(name),
    frames: 0,
  }));
});

const currentSequenceLabel = computed(() => {
  const option = sequenceOptions.value.find(
    (s) => s.value === currentSequence.value,
  );
  return option?.label ?? currentSequence.value;
});

let fpsFrames = 0;
let fpsLast = performance.now();

type PlayerControls = {
  play(): void;
  pause(): void;
  setLoop(loop: boolean): void;
  setSpeed(speed: number): void;
  fitToView(): void;
};

function activePlayer(): PlayerControls | null {
  return props.pet.type === "swf"
    ? (swfPlayer.value as PlayerControls | null)
    : (spinePlayer.value as PlayerControls | null);
}

function syncFrameCount(seqName = currentSequence.value) {
  if (props.pet.type === "swf") {
    const seq = props.pet.clip.sequences.find((s) => s.name === seqName);
    frameCount.value = seq?.frames.length ?? 0;
    return;
  }
  frameCount.value = frameCount.value || 1;
}

function syncPlayerBackground() {
  const bg = getCanvasBackgroundColor();
  swfPlayer.value?.setBackgroundColor(bg);
  spinePlayer.value?.setBackgroundColor(bg);
}

async function initSwfPlayer(clip: SwfClipData) {
  spinePlayer.value?.destroy();
  spinePlayer.value = null;

  currentSequence.value = clip.sequences[0]?.name ?? "standby";
  syncFrameCount();
  currentFrame.value = 0;

  const p = new SwfPlayer();
  p.setOnFrameChange((frame, total) => {
    currentFrame.value = frame;
    frameCount.value = total;
    emit("frameChange", frame, total);
    fpsFrames++;
    const now = performance.now();
    if (now - fpsLast >= 1000) {
      emit("fpsUpdate", fpsFrames);
      fpsFrames = 0;
      fpsLast = now;
    }
  });
  await p.mount(canvasHost.value!, clip, {
    backgroundColor: getCanvasBackgroundColor(),
    maxTextureSize: getEffectiveSwfMaxTextureSize(),
  });
  p.enablePan();
  p.setSequence(currentSequence.value);
  p.setLoop(loop.value);
  p.setSpeed(speed.value);
  if (playing.value) p.play();
  swfPlayer.value = p;
  if (import.meta.env.DEV) {
    installSwfBaselineHarness({
      getPlayer: () => swfPlayer.value,
      getClip: () => (props.pet.type === "swf" ? props.pet.clip : null),
    });
  }
}

async function initSpinePlayer(clip: SpineClipData) {
  swfPlayer.value?.destroy();
  swfPlayer.value = null;

  const defaultAnim =
    clip.animations.find((a) => a === "await" || a === "standby") ??
    clip.animations[0] ??
    "await";
  currentSequence.value = defaultAnim;
  currentFrame.value = 0;

  const p = new SpinePlayer();
  p.setOnFrameChange((frame, total) => {
    currentFrame.value = frame;
    frameCount.value = total;
    emit("frameChange", frame, total);
    fpsFrames++;
    const now = performance.now();
    if (now - fpsLast >= 1000) {
      emit("fpsUpdate", fpsFrames);
      fpsFrames = 0;
      fpsLast = now;
    }
  });
  await p.mount(canvasHost.value!, clip, {
    backgroundColor: getCanvasBackgroundColor(),
  });
  p.enablePan();
  p.setSequence(currentSequence.value);
  p.setLoop(loop.value);
  p.setSpeed(speed.value);
  if (playing.value) p.play();
  spinePlayer.value = p;
}

async function initPlayer() {
  if (!canvasHost.value) return;
  swfPlayer.value?.destroy();
  spinePlayer.value?.destroy();
  swfPlayer.value = null;
  spinePlayer.value = null;

  if (props.pet.type === "swf") {
    await initSwfPlayer(props.pet.clip);
  } else {
    await initSpinePlayer(props.pet.clip);
  }
}

watch(
  [() => props.pet, canvasHost],
  ([pet, host]) => {
    if (!pet || !host) return;
    void initPlayer();
  },
  { flush: "post", immediate: true },
);

watch(resolvedTheme, () => {
  syncPlayerBackground();
});

watch(currentSequence, (name) => {
  syncFrameCount(name);
  if (props.pet.type === "swf") {
    swfPlayer.value?.setSequence(name);
  } else {
    spinePlayer.value?.setSequence(name);
  }
  if (playing.value) activePlayer()?.play();
});

watch(playing, (v) => (v ? activePlayer()?.play() : activePlayer()?.pause()));
watch(loop, (v) => activePlayer()?.setLoop(v));
watch(speed, (v) => activePlayer()?.setSpeed(v));

function togglePlay() {
  playing.value = !playing.value;
}

function stepFrame(delta: number) {
  if (props.pet.type === "swf") {
    swfPlayer.value?.gotoFrame(currentFrame.value + delta);
  } else {
    spinePlayer.value?.gotoFrame(currentFrame.value + delta);
  }
}

function onSeek(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (props.pet.type === "swf") {
    swfPlayer.value?.gotoFrame(v);
  } else {
    spinePlayer.value?.gotoFrame(v);
  }
}

function fitView() {
  activePlayer()?.fitToView();
}

let fitViewFrame = 0;
let hostResizeObserver: ResizeObserver | null = null;

function scheduleFitView() {
  cancelAnimationFrame(fitViewFrame);
  fitViewFrame = requestAnimationFrame(() => {
    fitViewFrame = requestAnimationFrame(() => {
      activePlayer()?.fitToView();
    });
  });
}

watch(
  () => controlsCollapsed.value,
  () => {
    if (!props.isMobile) return;
    void nextTick(() => scheduleFitView());
  },
);

watch(
  canvasHost,
  (host) => {
    hostResizeObserver?.disconnect();
    hostResizeObserver = null;
    if (!host) return;

    let lastW = 0;
    let lastH = 0;
    hostResizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      if (
        Math.abs(rect.width - lastW) < 0.5 &&
        Math.abs(rect.height - lastH) < 0.5
      ) {
        return;
      }
      lastW = rect.width;
      lastH = rect.height;
      scheduleFitView();
    });
    hostResizeObserver.observe(host);
  },
  { flush: "post" },
);

function toggleControlsCollapsed() {
  controlsCollapsed.value = !controlsCollapsed.value;
}

function captureSource(): FrameCaptureSource | null {
  if (props.pet.type === "swf") return swfPlayer.value;
  return spinePlayer.value;
}

async function handleExport() {
  const source = captureSource();
  if (!source) return;
  await runExport(
    source,
    props.pet.clip.petId,
    currentSequence.value,
    getCanvasBackgroundColor(),
  );
  if (!exportError.value && props.isMobile) {
    closeExportModal();
  }
}

function openMobileExport() {
  openExportModal();
}

const exportProgressLabel = computed(() => {
  const p = exportProgress.value;
  if (!p) return "";
  const phase = p.phase === "capture" ? "捕获" : "编码";
  return `${phase} ${p.done}/${p.total}`;
});

onBeforeUnmount(() => {
  hostResizeObserver?.disconnect();
  cancelAnimationFrame(fitViewFrame);
  swfPlayer.value?.destroy();
  spinePlayer.value?.destroy();
});

defineExpose({ fitView });
</script>

<template>
  <div class="viewer" :class="[toolbarPosition, { mobile: isMobile }]">
    <div ref="canvasHost" class="canvas-host" />

    <aside
      class="controls"
      :class="{ collapsed: isMobile && controlsCollapsed }"
    >
      <div v-if="isMobile && controlsCollapsed" class="controls-collapsed-bar">
        <div class="controls-collapsed-info">
          <span class="controls-collapsed-label">{{ currentSequenceLabel }}</span>
          <span class="controls-collapsed-frame">
            {{ currentFrame + 1 }}/{{ frameCount }}
          </span>
          <button
            type="button"
            class="controls-collapsed-play primary"
            :disabled="exporting"
            @click="togglePlay"
          >
            {{ playing ? "暂停" : "播放" }}
          </button>
        </div>
        <div class="controls-collapsed-side">
          <button
            type="button"
            class="collapsed-action-btn"
            title="适应窗口"
            @click="fitView"
          >
            适应窗口
          </button>
          <button
            type="button"
            class="collapsed-action-btn"
            title="导出动画"
            :disabled="exporting"
            @click="openMobileExport"
          >
            导出动画
          </button>
          <button
            type="button"
            class="controls-collapse-btn compact"
            aria-label="展开控制栏"
            :aria-expanded="false"
            @click="toggleControlsCollapsed"
          >
            ▲
          </button>
        </div>
      </div>

      <div v-show="!isMobile || !controlsCollapsed" class="controls-body">
      <div class="controls-row controls-main">
        <div class="controls-main-top">
          <div class="seq-tabs">
            <button
              v-for="seq in sequenceOptions"
              :key="seq.value"
              :class="{ active: currentSequence === seq.value }"
              @click="currentSequence = seq.value"
            >
              {{ seq.label }}
              <span v-if="pet.type === 'swf'" class="count">{{ seq.frames }}</span>
            </button>
          </div>
          <button
            v-if="isMobile"
            type="button"
            class="controls-collapse-btn compact"
            aria-label="收起控制栏"
            :aria-expanded="true"
            @click="toggleControlsCollapsed"
          >
            ▼
          </button>
        </div>

        <div class="transport">
          <button :disabled="exporting" @click="stepFrame(-1)">上一帧</button>
          <button class="primary" :disabled="exporting" @click="togglePlay">
            {{ playing ? "暂停" : "播放" }}
          </button>
          <button :disabled="exporting" @click="stepFrame(1)">下一帧</button>
          <label class="check">
            <input v-model="loop" type="checkbox" :disabled="exporting" />
            循环
          </label>
        </div>
      </div>

      <div class="controls-row controls-secondary">
        <div class="scrub">
          <input
            type="range"
            :min="0"
            :max="Math.max(0, frameCount - 1)"
            :value="currentFrame"
            :disabled="exporting"
            @input="onSeek"
          />
          <span>{{ currentFrame + 1 }} / {{ frameCount }}</span>
        </div>

        <div class="speed">
          <label>速度 {{ speed.toFixed(2) }}×</label>
          <input v-model.number="speed" type="range" min="0.25" max="2" step="0.25" />
        </div>

        <button class="fit-btn" @click="fitView">适应窗口</button>

        <button
          v-if="isMobile"
          type="button"
          class="export-open-btn"
          :disabled="exporting"
          @click="openMobileExport"
        >
          导出动画
        </button>

        <div v-if="!isMobile" class="export-group">
          <label class="export-field">
            <span>格式</span>
            <select v-model="exportFormat" :disabled="exporting">
              <option value="webp">WebP</option>
              <option value="gif">GIF</option>
            </select>
          </label>
          <label class="export-field">
            <span>缩放</span>
            <select v-model.number="exportScale" :disabled="exporting">
              <option :value="1">1×</option>
              <option :value="2">2×</option>
              <option :value="3">3×</option>
            </select>
          </label>
          <label class="export-field">
            <span>背景</span>
            <select v-model="exportBackground" :disabled="exporting">
              <option value="transparent">透明</option>
              <option value="theme">当前主题</option>
            </select>
          </label>
          <button
            class="export-btn primary"
            :disabled="exporting"
            @click="handleExport"
          >
            {{ exporting ? exportProgressLabel || "导出中…" : "导出动画" }}
          </button>
        </div>
        <p v-if="exportError && !isMobile" class="export-error">{{ exportError }}</p>
      </div>
      </div>
    </aside>

    <ExportModal
      v-if="isMobile"
      :open="showExportModal"
      :exporting="exporting"
      :export-error="exportError"
      :export-progress-label="exportProgressLabel"
      :export-format="exportFormat"
      :export-scale="exportScale"
      :export-background="exportBackground"
      @close="closeExportModal()"
      @export="handleExport"
      @update:export-format="exportFormat = $event"
      @update:export-scale="exportScale = $event"
      @update:export-background="exportBackground = $event"
    />
  </div>
</template>

<style scoped>
.viewer {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 0;
}

.viewer.bottom {
  flex-direction: column;
}

.viewer.side {
  flex-direction: row;
}

.canvas-host {
  flex: 1;
  min-width: 0;
  min-height: 240px;
  position: relative;
  background: var(--canvas-bg);
}

.canvas-host :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  object-fit: contain;
}

.controls {
  background: var(--panel);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.viewer.bottom .controls {
  flex-shrink: 0;
  width: 100%;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  max-height: 40vh;
}

.viewer.side .controls {
  width: 280px;
  flex-shrink: 0;
  padding: 16px;
  border-left: 1px solid var(--border);
  border-top: none;
}

.controls-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.viewer.bottom .controls-main {
  flex-wrap: wrap;
  align-items: flex-start;
}

.viewer.bottom .controls-secondary {
  flex-wrap: wrap;
}

.viewer.side .controls-row {
  flex-direction: column;
  align-items: stretch;
}

.seq-tabs {
  display: flex;
  gap: 6px;
}

.viewer.bottom .seq-tabs {
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

.viewer.side .seq-tabs {
  flex-direction: column;
}

.seq-tabs button {
  text-align: left;
  display: flex;
  justify-content: space-between;
  white-space: nowrap;
}

.viewer.bottom .seq-tabs button {
  flex: 0 1 auto;
}

.seq-tabs button.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.count {
  color: var(--muted);
  font-size: 0.85em;
  margin-left: 8px;
}

.transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.viewer.side .transport {
  width: 100%;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9em;
  color: var(--muted);
}

.scrub {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85em;
  color: var(--muted);
}

.viewer.bottom .scrub {
  flex: 1;
  min-width: 180px;
}

.viewer.side .scrub {
  width: 100%;
}

.scrub input {
  width: 100%;
}

.speed {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9em;
  min-width: 140px;
}

.viewer.side .speed {
  width: 100%;
}

.fit-btn {
  flex-shrink: 0;
}

.viewer.side .fit-btn {
  width: 100%;
}

.export-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}

.viewer.side .export-group {
  width: 100%;
  flex-direction: column;
  align-items: stretch;
}

.export-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85em;
  color: var(--muted);
}

.export-field select {
  min-width: 72px;
}

.viewer.side .export-field select {
  width: 100%;
}

.export-btn {
  flex-shrink: 0;
}

.viewer.side .export-btn {
  width: 100%;
}

.export-error {
  margin: 0;
  font-size: 0.85em;
  color: var(--error);
  width: 100%;
}

.viewer.mobile .controls {
  flex-shrink: 0;
  max-height: min(46dvh, calc(100svh - 140px));
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

.viewer.mobile .controls.collapsed {
  max-height: none;
  padding: 12px 16px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  overflow: visible;
}

.controls-collapsed-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.controls-collapsed-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

.collapsed-action-btn {
  flex-shrink: 0;
  min-height: 36px;
  padding: 4px 8px;
  font-size: 0.78rem;
  white-space: nowrap;
}

.controls-collapsed-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.controls-main-top {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.viewer.bottom:not(.mobile) .controls-main-top {
  flex: 1;
  min-width: 0;
}

.viewer.side .controls-main-top {
  width: 100%;
}

.controls-main-top .seq-tabs {
  flex: 1;
  min-width: 0;
}

.controls-collapsed-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.controls-collapsed-frame {
  font-size: 0.82rem;
  color: var(--muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.controls-collapsed-play {
  flex-shrink: 0;
  min-height: 36px;
  padding: 4px 12px;
  font-size: 0.85rem;
}

.controls-collapse-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  min-width: 36px;
  padding: 4px 10px;
  font-size: 0.85rem;
  color: var(--muted);
  background: transparent;
  border-color: var(--border);
}

.controls-collapse-btn.compact {
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  font-size: 0.75rem;
  line-height: 1;
}

.controls-collapse-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.controls-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.viewer.mobile .controls-body {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.viewer.mobile .seq-tabs {
  flex-wrap: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 4px;
}

.viewer.mobile .seq-tabs button {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 8px 14px;
}

.viewer.mobile .transport {
  width: 100%;
}

.viewer.mobile .transport button {
  flex: 1;
  min-height: 44px;
}

.viewer.mobile .controls-row {
  flex-direction: column;
  align-items: stretch;
}

.viewer.mobile .controls-main-top {
  flex-direction: row;
}

.viewer.mobile .scrub,
.viewer.mobile .speed,
.viewer.mobile .fit-btn {
  width: 100%;
}

.viewer.mobile .fit-btn {
  min-height: 44px;
}

.export-open-btn {
  width: 100%;
  min-height: 44px;
}

@media (max-width: 400px) {
  .collapsed-action-btn {
    padding: 4px 6px;
    font-size: 0.72rem;
  }

  .controls-collapsed-frame {
    display: none;
  }
}
</style>
