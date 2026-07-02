<script setup lang="ts">
import { computed } from "vue";
import type { PetAnimIndexEntry } from "../lib/pet-anim-index";
import { formatFileSize } from "../lib/pet-anim-index";
import {
  downloadProgressPercent,
  type DownloadProgress,
} from "../lib/remote-bundle";

const props = defineProps<{
  loading?: boolean;
  loadingMessage?: string | null;
  downloadProgress?: DownloadProgress | null;
  error?: string | null;
  entry?: PetAnimIndexEntry | null;
  canRetry?: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  dismiss: [];
}>();

const progressPercent = computed(() => {
  if (!props.downloadProgress) return null;
  return downloadProgressPercent(props.downloadProgress);
});

const progressLabel = computed(() => {
  const progress = props.downloadProgress;
  if (!progress) return "";
  const loaded = formatFileSize(progress.loaded);
  if (progress.total && progress.total > 0) {
    const total = formatFileSize(progress.total);
    const percent = progressPercent.value;
    return percent !== null ? `${loaded} / ${total}（${percent}%）` : `${loaded} / ${total}`;
  }
  return `已下载 ${loaded}`;
});
</script>

<template>
  <div
    v-if="loading && loadingMessage"
    class="remote-notice remote-notice-loading"
    role="status"
    aria-live="polite"
  >
    <div class="remote-notice-loading-main">
      <span
        v-if="!downloadProgress"
        class="remote-notice-spinner"
        aria-hidden="true"
      />
      <span class="remote-notice-text">{{ loadingMessage }}</span>
    </div>

    <div v-if="downloadProgress" class="remote-progress">
      <div
        class="remote-progress-track"
        role="progressbar"
        :aria-valuenow="progressPercent ?? undefined"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuetext="progressLabel"
      >
        <div
          class="remote-progress-fill"
          :class="{ indeterminate: progressPercent === null }"
          :style="
            progressPercent !== null
              ? { width: `${progressPercent}%` }
              : undefined
          "
        />
      </div>
      <span class="remote-progress-label">{{ progressLabel }}</span>
    </div>
  </div>

  <div
    v-else-if="error"
    class="remote-notice remote-notice-error"
    role="alert"
  >
    <p class="remote-notice-title">加载失败</p>
    <p v-if="entry" class="remote-notice-target">
      精灵 #{{ entry.id }} · {{ entry.name }}
      <span class="remote-notice-kind">{{ entry.kind === "swf" ? "SWF" : "Spine" }}</span>
    </p>
    <p class="remote-notice-message">{{ error }}</p>
    <p v-if="canRetry" class="remote-notice-hint">
      可点击重试，或通过顶部菜单导入本地 bundle、<code>.swfclip</code> / <code>.spineclip</code> 目录。
    </p>
    <p v-else class="remote-notice-hint">
      请检查文件后重新导入，或通过顶部菜单选择其他资源。
    </p>
    <div class="remote-notice-actions">
      <button
        v-if="canRetry"
        type="button"
        class="primary"
        @click="emit('retry')"
      >
        重试
      </button>
      <button type="button" @click="emit('dismiss')">关闭</button>
    </div>
  </div>
</template>

<style scoped>
.remote-notice {
  width: 100%;
  max-width: 560px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 0.88rem;
}

.remote-notice-loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
}

.remote-notice-loading-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.remote-notice-text {
  line-height: 1.4;
}

.remote-notice-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: remote-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes remote-spin {
  to {
    transform: rotate(360deg);
  }
}

.remote-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.remote-progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  overflow: hidden;
}

.remote-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.15s ease-out;
}

.remote-progress-fill.indeterminate {
  width: 40% !important;
  animation: remote-progress-indeterminate 1.2s ease-in-out infinite;
}

@keyframes remote-progress-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}

.remote-progress-label {
  font-size: 0.82rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.remote-notice-error {
  border: 1px solid color-mix(in srgb, var(--error) 35%, var(--border));
  background: color-mix(in srgb, var(--error) 8%, var(--panel));
}

.remote-notice-title {
  margin: 0 0 6px;
  font-weight: 600;
  color: var(--error);
}

.remote-notice-target {
  margin: 0 0 4px;
  color: var(--text);
  font-size: 0.85rem;
}

.remote-notice-kind {
  margin-left: 6px;
  font-size: 0.78rem;
  color: var(--muted);
}

.remote-notice-message {
  margin: 0 0 8px;
  color: var(--text);
  line-height: 1.45;
}

.remote-notice-hint {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.remote-notice-hint code {
  font-size: 0.9em;
}

.remote-notice-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.remote-notice-actions button {
  min-height: 36px;
}

@media (max-width: 768px) {
  .remote-notice {
    max-width: none;
  }
}
</style>
