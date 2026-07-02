<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from "vue";
import AppHeader from "./components/AppHeader.vue";
import PetPicker from "./components/PetPicker.vue";
import RemoteLoadNotice from "./components/RemoteLoadNotice.vue";
import { usePetLoader } from "./composables/usePetLoader";
import { usePetAnimIndex } from "./composables/usePetAnimIndex";
import { useViewerSettings } from "./composables/useViewerSettings";
import {
  findPetIndexEntry,
  parsePetDeepLink,
} from "./lib/pet-deep-link";
import type { PetAnimIndex, PetAnimIndexEntry } from "./lib/pet-anim-index";
import { isRemoteBundleEnabled } from "./lib/remote-bundle";

const PetViewer = defineAsyncComponent(
  () => import("./components/PetViewer.vue"),
);

const {
  loading,
  error,
  loadingMessage,
  downloadProgress,
  remoteLoadContext,
  pet,
  parseMs,
  warnings,
  materialCount,
  sharedMaterialBundleName,
  loadBundleFile,
  loadBundleFromRemote,
  retryRemoteLoad,
  dismissError,
  loadSwfClipDir,
  loadSpineClipDir,
  loadMaterialBundle,
  reset,
} = usePetLoader();

const {
  effectiveToolbarPosition,
  isMobile,
  cycleTheme,
  toggleToolbarPosition,
} = useViewerSettings();

const { ensureIndexLoaded } = usePetAnimIndex();

const dragOver = ref(false);
const fps = ref(0);
const frameInfo = ref("-");
const deepLinkQuery = ref("");
const showStatusDetails = ref(false);

async function tryOpenPetFromQuery() {
  if (!isRemoteBundleEnabled()) return;

  const link = parsePetDeepLink(window.location.search);
  if (!link) return;

  deepLinkQuery.value = String(link.petId);

  try {
    const index = await ensureIndexLoaded();
    if (!index) return;
    const entry = findPetIndexEntry(index.entries, link);
    if (!entry) {
      error.value = `索引中未找到精灵 #${link.petId}，请尝试搜索其他 ID 或导入本地文件`;
      return;
    }
    await loadBundleFromRemote(entry, index.sharedBundles);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(() => {
  void tryOpenPetFromQuery();
});

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
    <AppHeader
      :pet-loaded="!!pet"
      :shared-material-bundle-name="sharedMaterialBundleName"
      @cycle-theme="cycleTheme"
      @toggle-toolbar-position="toggleToolbarPosition"
      @file-input="onFileInput"
      @spine-clip-input="onSpineClipInput"
      @material-input="onMaterialInput"
      @reset="reset"
    />

    <div
      v-if="!pet"
      class="dropzone"
      :class="{ dragover: dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop="onDrop"
    >
      <p v-if="loading && !isRemoteBundleEnabled()" class="loading-status">
        {{ loadingMessage || "正在解析…" }}
      </p>
      <template v-else>
        <RemoteLoadNotice
          :loading="loading"
          :loading-message="loadingMessage"
          :download-progress="downloadProgress"
          :error="error"
          :entry="remoteLoadContext?.entry ?? null"
          :can-retry="!!remoteLoadContext"
          @retry="retryRemoteLoad"
          @dismiss="dismissError"
        />
        <PetPicker
          :loading="loading"
          :initial-query="deepLinkQuery"
          @select="onRemoteSelect"
        />
        <p class="drop-title">拖放 <code>ppets_*</code> 或 <code>pskilltimeline_spines_*</code> bundle 到此处</p>
        <p class="drop-hint">
          或点击上方按钮选择文件；支持预转换 <code>.swfclip</code> / <code>.spineclip</code> 目录
        </p>
        <p class="drop-hint">
          SWF 精灵需额外导入共享材质
          <code>{{ sharedMaterialBundleName }}</code>
        </p>
      </template>
    </div>

    <template v-else>
      <div class="status-bar" :class="{ mobile: isMobile }">
        <span>精灵 #{{ pet.clip.petId }}</span>
        <span>{{ pet.type === "swf" ? "SWF" : "Spine" }}</span>
        <span>{{ frameInfo }}</span>

        <template v-if="!isMobile">
          <span v-if="pet.type === 'swf'">
            {{ pet.clip.atlasWidth }}×{{ pet.clip.atlasHeight }}
          </span>
          <span v-else>{{ pet.clip.animations.length }} 个动画</span>
          <span v-if="pet.type === 'swf'">{{ pet.clip.frameRate }} fps</span>
          <span v-if="materialCount > 0">共享材质 {{ materialCount }}</span>
          <span>解析 {{ parseMs }} ms</span>
          <span>渲染 {{ fps }} fps</span>
        </template>

        <template v-else>
          <button
            type="button"
            class="status-details-btn"
            :aria-expanded="showStatusDetails"
            @click="showStatusDetails = !showStatusDetails"
          >
            详情
          </button>
        </template>
      </div>

      <div v-if="isMobile && showStatusDetails" class="status-details">
        <span v-if="pet.type === 'swf'">
          {{ pet.clip.atlasWidth }}×{{ pet.clip.atlasHeight }}
        </span>
        <span v-else>{{ pet.clip.animations.length }} 个动画</span>
        <span v-if="pet.type === 'swf'">{{ pet.clip.frameRate }} fps</span>
        <span v-if="materialCount > 0">共享材质 {{ materialCount }}</span>
        <span>解析 {{ parseMs }} ms</span>
        <span>渲染 {{ fps }} fps</span>
      </div>

      <div v-if="warnings.length" class="warnings">
        <p v-for="(w, i) in warnings" :key="i">{{ w }}</p>
      </div>

      <Suspense>
        <PetViewer
          class="viewer-shell"
          :pet="pet"
          :toolbar-position="effectiveToolbarPosition"
          :is-mobile="isMobile"
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
  width: 100%;
  height: 100%;
  height: 100dvh;
  height: 100svh;
  overflow: hidden;
  min-height: 0;
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
  min-height: 0;
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

.loading-status {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 0.95rem;
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
  align-items: center;
}

.status-bar.mobile {
  gap: 12px;
  padding: 8px 12px;
}

.status-details-btn {
  margin-left: auto;
  padding: 4px 10px;
  font-size: 0.82rem;
  min-height: 32px;
}

.status-details {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 12px;
  font-size: 0.82rem;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  background: var(--panel);
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

.viewer-shell {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 768px) {
  .dropzone {
    margin: 8px;
    padding: 12px;
    justify-content: flex-start;
  }

  .drop-title {
    font-size: 0.95rem;
  }

  .drop-hint {
    font-size: 0.82rem;
    text-align: center;
  }
}
</style>
