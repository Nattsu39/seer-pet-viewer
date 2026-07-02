<script setup lang="ts">
import type { ExportFormat } from "@seer/anim-export";
import type {
  ExportBackgroundMode,
  ExportScale,
} from "../composables/useAnimationExport";

defineProps<{
  open: boolean;
  exporting: boolean;
  exportError: string | null;
  exportProgressLabel: string;
  exportFormat: ExportFormat;
  exportScale: ExportScale;
  exportBackground: ExportBackgroundMode;
}>();

const emit = defineEmits<{
  close: [];
  export: [];
  "update:exportFormat": [value: ExportFormat];
  "update:exportScale": [value: ExportScale];
  "update:exportBackground": [value: ExportBackgroundMode];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="export-modal-backdrop"
      @click="emit('close')"
    >
      <div
        class="export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        @click.stop
      >
        <header class="export-modal-header">
          <h2 id="export-modal-title">导出动画</h2>
          <button
            type="button"
            class="export-modal-close"
            aria-label="关闭"
            :disabled="exporting"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="export-modal-body">
          <label class="export-field">
            <span>格式</span>
            <select
              :value="exportFormat"
              :disabled="exporting"
              @change="
                emit(
                  'update:exportFormat',
                  ($event.target as HTMLSelectElement).value as ExportFormat,
                )
              "
            >
              <option value="webp">WebP</option>
              <option value="gif">GIF</option>
            </select>
          </label>
          <label class="export-field">
            <span>缩放</span>
            <select
              :value="exportScale"
              :disabled="exporting"
              @change="
                emit(
                  'update:exportScale',
                  Number(
                    ($event.target as HTMLSelectElement).value,
                  ) as ExportScale,
                )
              "
            >
              <option :value="1">1×</option>
              <option :value="2">2×</option>
              <option :value="3">3×</option>
            </select>
          </label>
          <label class="export-field">
            <span>背景</span>
            <select
              :value="exportBackground"
              :disabled="exporting"
              @change="
                emit(
                  'update:exportBackground',
                  ($event.target as HTMLSelectElement)
                    .value as ExportBackgroundMode,
                )
              "
            >
              <option value="transparent">透明</option>
              <option value="theme">当前主题</option>
            </select>
          </label>
          <p v-if="exportError" class="export-modal-error">{{ exportError }}</p>
        </div>

        <footer class="export-modal-footer">
          <button type="button" :disabled="exporting" @click="emit('close')">
            取消
          </button>
          <button
            type="button"
            class="primary"
            :disabled="exporting"
            @click="emit('export')"
          >
            {{ exporting ? exportProgressLabel || "导出中…" : "开始导出" }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.export-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  background: rgba(0, 0, 0, 0.45);
}

.export-modal {
  width: 100%;
  max-height: min(85dvh, 520px);
  border-radius: 16px 16px 0 0;
  border: 1px solid var(--border);
  border-bottom: none;
  background: var(--panel);
  display: flex;
  flex-direction: column;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

.export-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.export-modal-header h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.export-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  font-size: 1.4rem;
  line-height: 1;
  border-radius: 8px;
}

.export-modal-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
}

.export-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.88rem;
  color: var(--muted);
}

.export-field select {
  min-height: 44px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
}

.export-modal-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--error);
}

.export-modal-footer {
  display: flex;
  gap: 10px;
  padding: 12px 16px 0;
  flex-shrink: 0;
}

.export-modal-footer button {
  flex: 1;
  min-height: 44px;
}
</style>
