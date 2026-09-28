<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { downloadBlob } from "@seer-pet-anim/anim-export";
import type { PetClip } from "../composables/usePetLoader";
import { rebuildSwfInWorker } from "../lib/swf-rebuild";

const props = defineProps<{
  pet: PetClip;
  disabled?: boolean;
  compact?: boolean;
}>();
const LARGE_BUNDLE_BYTES = 15 * 1024 * 1024;
const scale = ref<number | string>(1);
const exporting = ref(false);
const status = ref("");
const error = ref("");
let controller: AbortController | null = null;

const unavailableReason = computed(() => {
  if (props.pet.type === "spine") return "Spine 动画不支持导出 SWF";
  if (!props.pet.bundleBuffer) return "请导入原始 bundle 后导出 SWF";
  if (!props.pet.sharedMaterialBuffer) return "请先导入 SWF 共享材质包";
  if (
    !Number.isSafeInteger(props.pet.clip.petId) ||
    props.pet.clip.petId <= 0
  ) {
    return "无法识别当前 bundle 的精灵编号";
  }
  return "";
});
const controlsDisabled = computed(
  () => props.disabled || exporting.value || !!unavailableReason.value,
);
const hint = computed(
  () =>
    unavailableReason.value ||
    "支持 1、0.5、0.25；bundle 超过 15 MB 时默认 0.5",
);
const validScale = computed(
  () => scale.value === 1 || scale.value === 0.5 || scale.value === 0.25,
);

watch(
  () => props.pet,
  (pet) => {
    controller?.abort();
    controller = null;
    exporting.value = false;
    status.value = "";
    error.value = "";
    scale.value =
      pet.type === "swf" &&
      (pet.bundleBuffer?.byteLength ?? 0) > LARGE_BUNDLE_BYTES
        ? 0.5
        : 1;
  },
  { immediate: true },
);

onBeforeUnmount(() => controller?.abort());

async function exportSwf(): Promise<void> {
  const pet = props.pet;
  const textureScale = scale.value;
  if (
    controlsDisabled.value ||
    pet.type !== "swf" ||
    !pet.bundleBuffer ||
    !pet.sharedMaterialBuffer ||
    (textureScale !== 1 && textureScale !== 0.5 && textureScale !== 0.25)
  )
    return;

  const current = new AbortController();
  controller = current;
  exporting.value = true;
  error.value = "";
  status.value = "正在准备导出…";
  try {
    const buffer = await rebuildSwfInWorker(
      {
        petId: pet.clip.petId,
        bundle: pet.bundleBuffer,
        materials: pet.sharedMaterialBuffer,
        textureScale,
      },
      current.signal,
      (message) => {
        status.value = message;
      },
    );
    current.signal.throwIfAborted();
    downloadBlob(
      new Blob([buffer], { type: "application/x-shockwave-flash" }),
      `${pet.clip.petId}.swf`,
    );
    status.value = "SWF 已导出";
  } catch (cause) {
    if (current.signal.aborted) return;
    status.value = "";
    error.value = `SWF 导出失败：${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    if (controller === current) {
      controller = null;
      exporting.value = false;
    }
  }
}
</script>

<template>
  <form
    class="swf-export"
    :class="{ compact }"
    aria-label="SWF 导出"
    :aria-description="hint"
    :title="hint"
    @submit.prevent="exportSwf"
  >
    <span class="title">SWF</span>
    <label>
      <span>{{ compact ? "倍率" : "缩放倍率" }}</span>
      <input
        v-model.number="scale"
        type="number"
        min="0.25"
        max="1"
        step="0.25"
        required
        :disabled="controlsDisabled"
        :aria-invalid="!validScale"
      />
    </label>
    <button
      type="submit"
      class="primary"
      :disabled="controlsDisabled || !validScale"
    >
      {{ exporting ? "导出中…" : "导出 SWF" }}
    </button>
    <small v-if="!compact">{{ hint }}</small>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
.swf-export {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 42%, transparent);
}

.title {
  flex-basis: 100%;
  font-size: 0.76rem;
  font-weight: 650;
  color: var(--muted);
}

label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  color: var(--muted);
}

input {
  width: 76px;
  min-height: 34px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}

input:disabled {
  opacity: 0.5;
}

small,
p {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.error {
  color: var(--error);
}

.compact {
  min-height: 48px;
  padding: 6px 8px;
  gap: 6px;
  align-content: center;
}

.compact .title {
  flex-basis: auto;
}

.compact label {
  white-space: nowrap;
}

.compact input {
  width: 60px;
}
</style>
