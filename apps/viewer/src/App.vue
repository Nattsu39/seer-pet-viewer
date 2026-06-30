<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref } from "vue";
import PetPicker from "./components/PetPicker.vue";
import { usePetLoader } from "./composables/usePetLoader";
import { useViewerSettings } from "./composables/useViewerSettings";
import type { PetAnimIndex, PetAnimIndexEntry } from "./lib/pet-anim-index";

const PetViewer = defineAsyncComponent(
  () => import("./components/PetViewer.vue"),
);

const {
  loading,
  error,
  pet,
  parseMs,
  warnings,
  materialCount,
  sharedMaterialBundleName,
  loadBundleFile,
  loadBundleFromRemote,
  loadSwfClipDir,
  loadSpineClipDir,
  loadMaterialBundle,
  reset,
} = usePetLoader();

const {
  toolbarPosition,
  themeLabel,
  nextThemeLabel,
  toolbarLabel,
  nextToolbarLabel,
  cycleTheme,
  toggleToolbarPosition,
} = useViewerSettings();

const dragOver = ref(false);
const fps = ref(0);
const frameInfo = ref("-");
const showInfoMenu = ref(false);
const infoMenuRef = ref<HTMLElement | null>(null);

function toggleInfoMenu(e: MouseEvent) {
  e.stopPropagation();
  showInfoMenu.value = !showInfoMenu.value;
}

function onDocClick(e: MouseEvent) {
  if (!showInfoMenu.value) return;
  const el = infoMenuRef.value;
  if (el && !el.contains(e.target as Node)) showInfoMenu.value = false;
}

onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));

function onDrop(e: DragEvent) {
  dragOver.value = false;
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  handleFiles(files);
}

async function handleFiles(files: FileList) {
  const arr = Array.from(files);
  const meta = arr.find((f) => f.name === "meta.json");
  if (meta) {
    const metaJson = JSON.parse(await meta.text()) as { kind?: string };
    if (metaJson.kind === "spine") {
      await loadSpineClipDir(arr);
      return;
    }
    if (arr.some((f) => f.name === "atlas.png")) {
      await loadSwfClipDir(arr);
      return;
    }
  }
  const bundle = arr.find((f) => !f.name.endsWith(".json"));
  if (bundle) await loadBundleFile(bundle);
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) handleFiles(input.files);
  input.value = "";
}

function onSpineClipInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) void loadSpineClipDir(input.files);
  input.value = "";
}

function onMaterialInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void loadMaterialBundle(file);
  input.value = "";
}

function onRemoteSelect(entry: PetAnimIndexEntry, index: PetAnimIndex) {
  void loadBundleFromRemote(entry, index.sharedBundles);
}
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="header-brand">
        <div class="header-title-row">
          <h1>坚果的赛尔号精灵动画查看器</h1>
          <div ref="infoMenuRef" class="info-menu">
            <button
              type="button"
              class="info-btn"
              aria-label="关于与联系方式"
              :aria-expanded="showInfoMenu"
              @click="toggleInfoMenu"
            >
              i
            </button>
            <div
              v-if="showInfoMenu"
              class="info-popover"
              role="dialog"
              aria-label="关于与联系方式"
            >
              <a
                href="https://github.com/Nattsu39/seer-pet-viewer"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub项目链接
              </a>
              <a
                href="https://space.bilibili.com/31797289"
                target="_blank"
                rel="noopener noreferrer"
              >
                作者的B站主页
              </a>
              <a href="mailto:nattsu39@outlook.com">联系方式（邮箱）</a>
            </div>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <button
          type="button"
          class="btn-setting"
          :title="`切换主题（当前：${themeLabel}，下次：${nextThemeLabel}）`"
          @click="cycleTheme"
        >
          {{ themeLabel }}
        </button>
        <button
          type="button"
          class="btn-setting"
          :title="`切换工具栏位置（当前：${toolbarLabel}，下次：${nextToolbarLabel}）`"
          @click="toggleToolbarPosition"
        >
          工具栏：{{ toolbarLabel }}
        </button>
        <label class="btn primary">
          导入 Bundle
          <input type="file" hidden @change="onFileInput" />
        </label>
        <label class="btn">
          导入 .swfclip
          <input
            type="file"
            hidden
            multiple
            webkitdirectory
            @change="onFileInput"
          />
        </label>
        <label class="btn">
          导入 .spineclip
          <input
            type="file"
            hidden
            multiple
            webkitdirectory
            @change="onSpineClipInput"
          />
        </label>
        <label
          class="btn"
          :title="`导入 FlashTools 共享 SWF 材质：${sharedMaterialBundleName}`"
        >
          导入共享材质
          <input type="file" hidden accept=".bundle" @change="onMaterialInput" />
        </label>
        <button v-if="pet" @click="reset">关闭</button>
      </div>
    </header>

    <div
      v-if="!pet"
      class="dropzone"
      :class="{ dragover: dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="onDrop"
    >
      <p v-if="loading">正在解析…</p>
      <template v-else>
        <PetPicker :loading="loading" @select="onRemoteSelect" />
        <p class="drop-title">拖放 <code>ppets_*</code> 或 <code>pskilltimeline_spines_*</code> bundle 到此处</p>
        <p class="drop-hint">
          或点击上方按钮选择文件；支持预转换 <code>.swfclip</code> / <code>.spineclip</code> 目录
        </p>
        <p class="drop-hint">
          SWF 精灵需额外导入共享材质
          <code>{{ sharedMaterialBundleName }}</code>
        </p>
        <p v-if="error" class="error">{{ error }}</p>
      </template>
    </div>

    <template v-else>
      <div class="status-bar">
        <span>精灵 #{{ pet.clip.petId }}</span>
        <span>{{ pet.type === "swf" ? "SWF" : "Spine" }}</span>
        <span v-if="pet.type === 'swf'">
          {{ pet.clip.atlasWidth }}×{{ pet.clip.atlasHeight }}
        </span>
        <span v-else>{{ pet.clip.animations.length }} 个动画</span>
        <span v-if="pet.type === 'swf'">{{ pet.clip.frameRate }} fps</span>
        <span v-if="materialCount > 0">共享材质 {{ materialCount }}</span>
        <span>解析 {{ parseMs }} ms</span>
        <span>{{ frameInfo }}</span>
        <span>渲染 {{ fps }} fps</span>
      </div>

      <div v-if="warnings.length" class="warnings">
        <p v-for="(w, i) in warnings" :key="i">{{ w }}</p>
      </div>

      <Suspense>
        <PetViewer
          :pet="pet"
          :toolbar-position="toolbarPosition"
          @frame-change="(f, t) => (frameInfo = `帧 ${f + 1}/${t}`)"
          @fps-update="(v) => (fps = v)"
        />
        <template #fallback>
          <div class="loading-viewer">正在初始化渲染器…</div>
        </template>
      </Suspense>
    </template>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
  gap: 12px;
  flex-wrap: wrap;
}

.header-brand {
  display: flex;
  align-items: center;
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header h1 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
}

.info-menu {
  position: relative;
}

.info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 600;
  font-style: italic;
  line-height: 1;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
}

.info-btn:hover,
.info-btn[aria-expanded="true"] {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.info-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.info-popover a {
  padding: 6px 10px;
  border-radius: 4px;
  color: var(--text);
  text-decoration: none;
  font-size: 0.85rem;
  white-space: nowrap;
}

.info-popover a:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.btn-setting {
  font-size: 0.85rem;
  white-space: nowrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  cursor: pointer;
  font-size: 0.9rem;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.dropzone {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: 24px;
  padding: 16px;
  border: 2px dashed var(--border);
  border-radius: 12px;
  color: var(--muted);
  transition:
    border-color 0.15s,
    background 0.15s;
}

.dropzone.dragover {
  border-color: var(--accent);
  background: var(--dropzone-active-bg);
}

.drop-title {
  font-size: 1.1rem;
  color: var(--text);
  margin: 0 0 8px;
}

.drop-hint {
  margin: 0;
  font-size: 0.9rem;
}

.error {
  color: var(--error);
  margin-top: 16px;
}

.loading-viewer {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}

.status-bar {
  display: flex;
  gap: 20px;
  padding: 8px 20px;
  font-size: 0.85rem;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.warnings {
  padding: 8px 20px;
  background: var(--warning-bg);
  border-bottom: 1px solid var(--warning-border);
  font-size: 0.82rem;
  color: var(--warning-text);
}

.warnings p {
  margin: 2px 0;
}
</style>
