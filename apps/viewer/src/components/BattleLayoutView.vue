<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import PetPicker from "./PetPicker.vue";
import { SwfPlayer } from "@seer/swf-renderer";
import { SpinePlayer } from "@seer/spine-renderer";
import { ensureSwfClipAtlas } from "@seer/swf-bundle/parse";
import { disposePetClip } from "../lib/dispose-pet-clip";
import { shouldStartSceneDrag } from "../lib/scene-drag";
import { getEffectiveSwfMaxTextureSize } from "../lib/swf-texture";
import { getAnimationLabel } from "../lib/animation-labels";
import type { PetClip } from "../composables/usePetLoader";
import { usePetLoader } from "../composables/usePetLoader";
import { useAnimationExport } from "../composables/useAnimationExport";
import {
  getCanvasBackgroundColor,
  useViewerSettings,
} from "../composables/useViewerSettings";
import type { PetAnimIndex, PetAnimIndexEntry } from "../lib/pet-anim-index";
import {
  BATTLE_DESIGN_HEIGHT,
  BATTLE_DESIGN_WIDTH,
  DEFAULT_BATTLE_CONTAINER_WORLD_Y,
  DEFAULT_BATTLE_PX_PER_UNIT,
  computeBattlePetPlacement,
  fitBattleCanvas,
  projectBattlePlacement,
  type BattleSide,
} from "@seer/battle-layout";

type BattlePlayer = SwfPlayer | SpinePlayer;

const { autoImportSharedMaterials, canvasBackgroundColor } =
  useViewerSettings();

const {
  exporting,
  exportError,
  exportProgress,
  exportFormat,
  exportScale,
  exportBackground,
  runExport,
} = useAnimationExport();

/* ---------------- 场景几何（设计稿容器缩放 + 场景级 pan/zoom） ---------------- */

const sceneHost = ref<HTMLElement | null>(null);
const stageSize = reactive({ width: 0, height: 0 });
const sceneZoom = ref(1);
const scenePan = reactive({ x: 0, y: 0 });
const MIN_SCENE_ZOOM = 0.25;
const MAX_SCENE_ZOOM = 6;

const stageStyle = computed(() => ({
  width: `${stageSize.width}px`,
  height: `${stageSize.height}px`,
  transform: `translate(calc(-50% + ${scenePan.x}px), calc(-50% + ${scenePan.y}px))`,
}));

let sceneResizeObserver: ResizeObserver | null = null;

function recomputeStage(): void {
  const el = sceneHost.value;
  if (!el) return;
  const base = Math.min(
    el.clientWidth / BATTLE_DESIGN_WIDTH,
    el.clientHeight / BATTLE_DESIGN_HEIGHT,
  );
  stageSize.width = Math.max(
    1,
    Math.round(BATTLE_DESIGN_WIDTH * base * sceneZoom.value),
  );
  stageSize.height = Math.max(
    1,
    Math.round(BATTLE_DESIGN_HEIGHT * base * sceneZoom.value),
  );
  applyLayout();
}

function resetSceneView(): void {
  sceneZoom.value = 1;
  scenePan.x = 0;
  scenePan.y = 0;
  recomputeStage();
}

function zoomBy(factor: number): void {
  sceneZoom.value = Math.min(
    MAX_SCENE_ZOOM,
    Math.max(MIN_SCENE_ZOOM, sceneZoom.value * factor),
  );
}

watch(sceneZoom, () => recomputeStage());
watch(sceneHost, (el) => {
  sceneResizeObserver?.disconnect();
  sceneResizeObserver = null;
  if (!el) return;
  sceneResizeObserver = new ResizeObserver(() => recomputeStage());
  sceneResizeObserver.observe(el);
  recomputeStage();
}, { flush: "post" });

let dragging = false;
let dragStart = { x: 0, y: 0 };
let dragPanStart = { x: 0, y: 0 };

function onScenePointerDown(e: PointerEvent): void {
  if (!shouldStartSceneDrag(e)) return;
  dragging = true;
  dragStart = { x: e.clientX, y: e.clientY };
  dragPanStart = { x: scenePan.x, y: scenePan.y };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onScenePointerMove(e: PointerEvent): void {
  if (!dragging) return;
  scenePan.x = dragPanStart.x + (e.clientX - dragStart.x);
  scenePan.y = dragPanStart.y + (e.clientY - dragStart.y);
}

function onScenePointerUp(e: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

function onSceneWheel(e: WheelEvent): void {
  zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
}

/* ---------------- 布局微调（单位像素比 / 场景容器 y 偏移） ---------------- */

const pxPerUnit = ref(DEFAULT_BATTLE_PX_PER_UNIT);
const containerWorldY = ref(DEFAULT_BATTLE_CONTAINER_WORLD_Y);

function resetLayoutTuning(): void {
  pxPerUnit.value = DEFAULT_BATTLE_PX_PER_UNIT;
  containerWorldY.value = DEFAULT_BATTLE_CONTAINER_WORLD_Y;
}

watch([pxPerUnit, containerWorldY], () => applyLayout());

/* ---------------- 垫底截图（用于与客户端截图比对校准） ---------------- */

const underlayUrl = ref<string | null>(null);
const underlayOpacity = ref(1);

function onUnderlayInput(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (underlayUrl.value) URL.revokeObjectURL(underlayUrl.value);
  underlayUrl.value = URL.createObjectURL(file);
}

function clearUnderlay(): void {
  if (underlayUrl.value) URL.revokeObjectURL(underlayUrl.value);
  underlayUrl.value = null;
}

/* ---------------- 双侧精灵加载与渲染 ---------------- */

interface SideViewState {
  sequence: string;
  playing: boolean;
  currentFrame: number;
  frameCount: number;
  host: HTMLElement | null;
  mounting: boolean;
}

const players: Record<BattleSide, BattlePlayer | null> = {
  left: null,
  right: null,
};
const activeClips: Record<BattleSide, PetClip | null> = {
  left: null,
  right: null,
};
const mountTokens: Record<BattleSide, number> = { left: 0, right: 0 };

function setLayerHost(side: BattleSide, el: unknown): void {
  sideStates[side].view.host = (el as HTMLElement | null) ?? null;
}

function createSideState(side: BattleSide) {
  const loader = usePetLoader({
    autoImportSharedMaterials: () => autoImportSharedMaterials.value,
  });
  const view: SideViewState = reactive({
    sequence: "",
    playing: true,
    currentFrame: 0,
    frameCount: 0,
    host: null,
    mounting: false,
  });

  watch(
    [() => loader.pet.value, () => view.host],
    ([pet, host]) => {
      if (pet && host) void mountSidePlayer(side);
    },
    { flush: "post" },
  );

  watch(
    () => view.sequence,
    (name) => {
      const player = players[side];
      if (!player || !name) return;
      player.setSequence(name);
      if (view.playing) player.play();
    },
  );

  watch(
    () => view.playing,
    (v) => (v ? players[side]?.play() : players[side]?.pause()),
  );

  return { loader, view };
}

const leftSide = createSideState("left");
const rightSide = createSideState("right");
const sideStates: Record<BattleSide, ReturnType<typeof createSideState>> = {
  left: leftSide,
  right: rightSide,
};

const SIDES: BattleSide[] = ["left", "right"];

function state(side: BattleSide): ReturnType<typeof createSideState> {
  return sideStates[side];
}

function sidePet(side: BattleSide): PetClip | null {
  return state(side).loader.pet.value;
}

function sideLoading(side: BattleSide): boolean {
  return state(side).loader.loading.value;
}

function sideError(side: BattleSide): string | null {
  return state(side).loader.error.value;
}

function onSideSelect(
  side: BattleSide,
  entry: PetAnimIndexEntry,
  index: PetAnimIndex,
): void {
  void state(side).loader.loadBundleFromRemote(entry, index.sharedBundles);
}

function clearSide(side: BattleSide): void {
  // 与 onBeforeUnmount 相同的清理：销毁画布并释放 clip，避免残留冻结帧
  mountTokens[side]++;
  players[side]?.destroy();
  players[side] = null;
  if (activeClips[side]) {
    disposePetClip(activeClips[side]!);
    activeClips[side] = null;
  }
  state(side).loader.reset();
}

function sideSequenceOptions(side: BattleSide): Array<{
  value: string;
  label: string;
}> {
  const pet = sidePet(side);
  if (!pet) return [];
  const names =
    pet.type === "swf"
      ? pet.clip.sequences.map((s) => s.name)
      : pet.clip.animations;
  return names.map((name) => ({ value: name, label: getAnimationLabel(name) }));
}

function defaultSequenceOf(pet: PetClip): string {
  if (pet.type === "swf") return pet.clip.sequences[0]?.name ?? "standby";
  return (
    pet.clip.animations.find((a) => a === "await" || a === "standby") ??
    pet.clip.animations[0] ??
    "await"
  );
}

async function mountSidePlayer(side: BattleSide): Promise<void> {
  const st = state(side);
  const pet = st.loader.pet.value;
  const host = st.view.host;
  if (!pet || !host || st.view.mounting) return;

  const token = ++mountTokens[side];
  st.view.mounting = true;
  try {
    players[side]?.destroy();
    players[side] = null;
    if (activeClips[side] && activeClips[side] !== pet) {
      disposePetClip(activeClips[side]!);
    }
    activeClips[side] = pet;

    st.view.currentFrame = 0;
    st.view.frameCount = 0;

    const onFrame = (frame: number, total: number): void => {
      if (mountTokens[side] !== token) return;
      st.view.currentFrame = frame;
      st.view.frameCount = total;
    };

    let player: BattlePlayer;
    if (pet.type === "swf") {
      await ensureSwfClipAtlas(pet.clip, pet.bundleBuffer ?? null);
      if (mountTokens[side] !== token || st.loader.pet.value !== pet) return;
      const p = new SwfPlayer();
      p.setOnFrameChange(onFrame);
      await p.mount(host, pet.clip, {
        backgroundColor: getCanvasBackgroundColor(),
        maxTextureSize: getEffectiveSwfMaxTextureSize(),
        releaseAtlasAfterSplit: pet.bundleBuffer != null,
        releaseAtlasAfterUpload: pet.bundleBuffer != null,
        mode: "fixed",
        // 双层画布叠加：各自透明，背景色由 .battle-scene 提供
        transparent: true,
      });
      player = p;
    } else {
      const p = new SpinePlayer();
      p.setOnFrameChange(onFrame);
      await p.mount(host, pet.clip, {
        backgroundColor: getCanvasBackgroundColor(),
        mode: "fixed",
        transparent: true,
      });
      player = p;
    }

    if (mountTokens[side] !== token || st.loader.pet.value !== pet) {
      player.destroy();
      return;
    }

    players[side] = player;
    st.view.sequence = defaultSequenceOf(pet);
    player.setSequence(st.view.sequence);
    player.setLoop(true);
    if (st.view.playing) player.play();
    applyLayoutToSide(side);
  } finally {
    if (mountTokens[side] === token) st.view.mounting = false;
  }
}

function applyLayoutToSide(side: BattleSide): void {
  const player = players[side];
  if (!player || stageSize.width <= 0) return;
  const fit = fitBattleCanvas(stageSize.width, stageSize.height);
  const placement = computeBattlePetPlacement(side, {
    pxPerUnit: pxPerUnit.value,
    containerWorldY: containerWorldY.value,
  });
  const projected = projectBattlePlacement(placement, fit);
  // scale.y 取负维持「内容 y 向上、画布原点左上」的预览翻转约定
  player.setFixedTransform(projected.position, {
    x: projected.pixelsPerUnitX,
    y: -projected.pixelsPerUnitY,
  });
}

function applyLayout(): void {
  applyLayoutToSide("left");
  applyLayoutToSide("right");
}

watch(canvasBackgroundColor, () => {
  const bg = getCanvasBackgroundColor();
  players.left?.setBackgroundColor(bg);
  players.right?.setBackgroundColor(bg);
});

function sideGotoFrame(side: BattleSide, frame: number): void {
  players[side]?.gotoFrame(frame);
}

function sideStepFrame(side: BattleSide, delta: number): void {
  sideGotoFrame(side, state(side).view.currentFrame + delta);
}

/* ---------------- 导出（战斗视口：锚点=布局中心） ---------------- */

const selectedSide = ref<BattleSide>("left");
const exportable = computed(() => !!sidePet(selectedSide.value));

const exportProgressLabel = computed(() => {
  const p = exportProgress.value;
  if (!p) return "";
  const phase = p.phase === "capture" ? "捕获" : "编码";
  return `${phase} ${p.done}/${p.total}`;
});

async function handleExport(): Promise<void> {
  const side = selectedSide.value;
  const pet = sidePet(side);
  const player = players[side];
  if (!pet || !player) return;
  await runExport(
    player,
    pet.clip.petId,
    state(side).view.sequence,
    getCanvasBackgroundColor(),
    {
      side,
      pxPerUnit: pxPerUnit.value,
      containerWorldY: containerWorldY.value,
    },
  );
}

/* ---------------- 清理 ---------------- */

onBeforeUnmount(() => {
  for (const side of SIDES) {
    mountTokens[side]++;
    players[side]?.destroy();
    players[side] = null;
    if (activeClips[side]) {
      disposePetClip(activeClips[side]!);
      activeClips[side] = null;
    }
    state(side).loader.reset();
  }
  sceneResizeObserver?.disconnect();
  sceneResizeObserver = null;
  clearUnderlay();
});
</script>

<template>
  <div class="battle-layout">
    <div
      ref="sceneHost"
      class="battle-scene"
      @pointerdown="onScenePointerDown"
      @pointermove="onScenePointerMove"
      @pointerup="onScenePointerUp"
      @pointercancel="onScenePointerUp"
      @wheel="onSceneWheel"
    >
      <div class="battle-stage" :style="stageStyle">
        <img
          v-if="underlayUrl"
          class="underlay"
          :src="underlayUrl"
          :style="{ opacity: underlayOpacity }"
          alt=""
          draggable="false"
        />
        <div class="pet-layer">
          <div :ref="(el) => setLayerHost('left', el)" class="pet-host" />
        </div>
        <div class="pet-layer">
          <div :ref="(el) => setLayerHost('right', el)" class="pet-host" />
        </div>
      </div>

      <p v-if="!sidePet('left') && !sidePet('right')" class="scene-empty">
        在右侧面板选择左右两侧精灵
      </p>

      <div class="scene-tools">
        <button type="button" title="放大" @click="zoomBy(1.2)">＋</button>
        <button type="button" title="缩小" @click="zoomBy(1 / 1.2)">－</button>
        <button type="button" @click="resetSceneView">重置视图</button>
        <span class="scene-zoom-label">{{ Math.round(sceneZoom * 100) }}%</span>
      </div>
    </div>

    <aside class="battle-panel">
      <section class="panel-group" aria-label="布局微调">
        <span class="group-title">布局微调</span>
        <div class="tuning-fields">
          <label>
            <span>单位像素比</span>
            <input
              v-model.number="pxPerUnit"
              type="number"
              min="1"
              max="400"
              step="1"
            />
          </label>
          <label>
            <span>场景 Y 偏移</span>
            <input
              v-model.number="containerWorldY"
              type="number"
              step="0.5"
            />
          </label>
          <button type="button" class="compact-btn" @click="resetLayoutTuning">
            重置默认
          </button>
        </div>
        <p class="hint">
          默认 {{ DEFAULT_BATTLE_PX_PER_UNIT }}（未校准，可垫底客户端截图比对调整）
        </p>
      </section>

      <section class="panel-group" aria-label="垫底截图">
        <span class="group-title">垫底截图</span>
        <div class="underlay-controls">
          <label class="underlay-file">
            <input type="file" accept="image/*" @change="onUnderlayInput" />
            <span>选择图片…</span>
          </label>
          <template v-if="underlayUrl">
            <label class="underlay-opacity">
              <span>不透明度</span>
              <input
                v-model.number="underlayOpacity"
                type="range"
                min="0"
                max="1"
                step="0.05"
              />
            </label>
            <button type="button" class="compact-btn" @click="clearUnderlay">
              移除
            </button>
          </template>
        </div>
        <p class="hint">截图将拉伸铺满 16:9 设计稿，用于肉眼比对宠物位置</p>
      </section>

      <section
        v-for="side in SIDES"
        :key="side"
        class="panel-group side-panel"
        :class="{ selected: selectedSide === side }"
        @click="selectedSide = side"
      >
        <span class="group-title">
          {{ side === "left" ? "左侧（我方）" : "右侧（敌方镜像）" }}
        </span>

        <template v-if="!sidePet(side)">
          <p v-if="sideLoading(side)" class="hint">正在加载…</p>
          <p v-else-if="sideError(side)" class="side-error">
            {{ sideError(side) }}
          </p>
          <PetPicker
            class="side-picker"
            :loading="sideLoading(side)"
            @select="(entry, index) => onSideSelect(side, entry, index)"
          />
        </template>

        <template v-else>
          <div class="side-head">
            <span class="side-pet-label">
              精灵 #{{ sidePet(side)!.clip.petId }}
              <em>{{ sidePet(side)!.type === "swf" ? "SWF" : "Spine" }}</em>
            </span>
            <button
              type="button"
              class="compact-btn"
              :disabled="exporting"
              @click="clearSide(side)"
            >
              换一只
            </button>
          </div>
          <p v-if="state(side).view.mounting" class="hint">正在初始化渲染器…</p>
          <div class="side-controls" @click.stop>
            <label class="side-sequence">
              <span>序列</span>
              <select v-model="state(side).view.sequence" :disabled="exporting">
                <option
                  v-for="opt in sideSequenceOptions(side)"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
            </label>
            <div class="side-transport">
              <button
                type="button"
                :disabled="exporting"
                @click="sideStepFrame(side, -1)"
              >
                上一帧
              </button>
              <button
                type="button"
                class="primary"
                :disabled="exporting"
                @click="state(side).view.playing = !state(side).view.playing"
              >
                {{ state(side).view.playing ? "暂停" : "播放" }}
              </button>
              <button
                type="button"
                :disabled="exporting"
                @click="sideStepFrame(side, 1)"
              >
                下一帧
              </button>
            </div>
            <div class="side-scrub">
              <input
                type="range"
                :min="0"
                :max="Math.max(0, state(side).view.frameCount - 1)"
                :value="state(side).view.currentFrame"
                :disabled="exporting"
                @input="
                  sideGotoFrame(
                    side,
                    Number(($event.target as HTMLInputElement).value),
                  )
                "
              />
              <span>
                {{ state(side).view.currentFrame + 1 }} /
                {{ state(side).view.frameCount }}
              </span>
            </div>
          </div>
        </template>
      </section>

      <section class="panel-group" aria-label="导出设置">
        <span class="group-title">导出（战斗视口）</span>
        <p class="hint">
          导出{{ selectedSide === "left" ? "左" : "右" }}侧当前序列；
          画布固定为 1920×1080 战斗设计帧，所有序列同尺寸同比例，
          超出画布的内容按客户端行为裁剪；设计帧已达导出上限 1920px，
          倍率固定为 1×
        </p>
        <div class="export-controls">
          <label>
            <span>格式</span>
            <select v-model="exportFormat" :disabled="exporting">
              <option value="webp">WebP</option>
              <option value="gif">GIF</option>
              <option value="png-sequence">PNG（序列帧）</option>
            </select>
          </label>
          <label>
            <span>缩放</span>
            <select
              v-model.number="exportScale"
              disabled
              title="战斗视口固定 1920×1080，已达导出上限，倍率不可调整"
            >
              <option :value="1">1×</option>
              <option :value="2">2×</option>
              <option :value="3">3×</option>
            </select>
          </label>
          <label class="check">
            <input v-model="exportBackground" type="checkbox" :disabled="exporting" />
            <span>背景色</span>
          </label>
        </div>
        <button
          type="button"
          class="primary export-btn"
          :disabled="exporting || !exportable"
          @click="handleExport"
        >
          {{ exporting ? exportProgressLabel || "导出中…" : "导出动画" }}
        </button>
        <p v-if="exportError" class="side-error">{{ exportError }}</p>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.battle-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}

.battle-scene {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: var(--canvas-bg);
  touch-action: none;
  cursor: grab;
}

.battle-scene:active {
  cursor: grabbing;
}

.battle-stage {
  position: absolute;
  left: 50%;
  top: 50%;
}

.underlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.pet-layer {
  position: absolute;
  inset: 0;
}

.pet-host {
  width: 100%;
  height: 100%;
}

.scene-empty {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  color: var(--muted);
  font-size: 0.95rem;
  pointer-events: none;
}

.scene-tools {
  position: absolute;
  left: 12px;
  top: 12px;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 85%, transparent);
}

.scene-tools button {
  min-height: 30px;
  min-width: 32px;
  padding: 2px 8px;
}

.scene-zoom-label {
  min-width: 42px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--muted);
}

.battle-panel {
  flex: 0 0 340px;
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
  background: var(--panel);
  border-left: 1px solid var(--border);
}

.panel-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 42%, transparent);
}

.group-title {
  font-size: 0.76rem;
  font-weight: 650;
  color: var(--muted);
  letter-spacing: 0.04em;
}

.hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.45;
}

.tuning-fields {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.tuning-fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--muted);
}

.tuning-fields input[type="number"] {
  width: 92px;
  min-height: 32px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}

.underlay-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.underlay-file {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
}

.underlay-file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.underlay-opacity {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--muted);
  flex: 1;
  min-width: 120px;
}

.compact-btn {
  min-height: 32px;
  padding: 4px 8px;
  white-space: nowrap;
}

.side-panel {
  cursor: pointer;
}

.side-panel.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent-soft) 35%, transparent);
}

.side-picker {
  max-width: none;
  margin: 0;
}

.side-picker :deep(.pet-picker) {
  max-width: none;
  margin: 0;
  padding: 10px;
}

.side-error {
  margin: 0;
  font-size: 0.82rem;
  color: var(--error);
}

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.side-pet-label {
  font-size: 0.9rem;
  color: var(--text);
}

.side-pet-label em {
  font-style: normal;
  font-size: 0.78rem;
  color: var(--muted);
  margin-left: 6px;
}

.side-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.side-sequence {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--muted);
}

.side-sequence select {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}

.side-transport {
  display: flex;
  gap: 6px;
}

.side-transport button {
  flex: 1;
  min-height: 32px;
  padding: 4px 8px;
  font-size: 0.82rem;
}

.side-scrub {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--muted);
}

.side-scrub input {
  flex: 1;
  min-width: 0;
}

.export-controls {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.export-controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--muted);
}

.export-controls select {
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}

.export-controls .check {
  flex-direction: row;
  align-items: center;
  min-height: 34px;
}

.export-btn {
  width: 100%;
  min-height: 36px;
}

@media (max-width: 900px) {
  .battle-layout {
    flex-direction: column;
  }

  .battle-scene {
    flex: 1 1 auto;
    min-height: 260px;
  }

  .battle-panel {
    flex: 0 1 auto;
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border);
    max-height: 55%;
  }
}
</style>
