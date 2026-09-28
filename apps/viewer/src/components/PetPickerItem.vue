<script setup lang="ts">
import { computed } from "vue";
import { formatFileSize, type PetAnimIndexEntry } from "../lib/pet-anim-index";
import { hasCdnMirror, isRemoteBundleAllowed } from "../lib/remote-bundle";

const props = defineProps<{
  entry: PetAnimIndexEntry;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [entry: PetAnimIndexEntry];
}>();

const remoteBlocked = computed(() => !isRemoteBundleAllowed(props.entry));
const usesCdn = computed(() => hasCdnMirror(props.entry));
const itemDisabled = computed(() => props.disabled || remoteBlocked.value);

function kindLabel(kind: PetAnimIndexEntry["kind"]) {
  return kind === "swf" ? "SWF" : "Spine";
}

function variantLabel(entry: PetAnimIndexEntry) {
  return entry.variant === "small" ? "（小）" : "";
}
</script>

<template>
  <button
    v-memo="[entry.name, entry.fileSize, itemDisabled]"
    type="button"
    class="pet-picker-item"
    :class="{ 'pet-picker-item--local-only': remoteBlocked }"
    :disabled="itemDisabled"
    :title="
      remoteBlocked ? '图床暂无镜像，请通过顶部菜单导入本地 bundle' : undefined
    "
    @click="emit('select', entry)"
  >
    <span class="pet-picker-id">#{{ entry.id }}</span>
    <span class="pet-picker-name"
      >{{ entry.name }}{{ variantLabel(entry) }}</span
    >
    <span class="pet-picker-size">
      {{ formatFileSize(entry.fileSize) }}
      <span v-if="usesCdn" class="pet-picker-size-note">图床</span>
      <span v-else-if="remoteBlocked" class="pet-picker-size-note">仅本地</span>
    </span>
    <span class="pet-picker-kind">{{ kindLabel(entry.kind) }}</span>
  </button>
</template>

<style scoped>
.pet-picker-item {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font-size: 0.88rem;
  min-height: 44px;
}

.pet-picker-item:last-child {
  border-bottom: none;
}

.pet-picker-item:hover:not(:disabled) {
  background: var(--accent-soft);
}

.pet-picker-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pet-picker-id {
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  font-weight: 600;
}

.pet-picker-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-picker-size {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  white-space: nowrap;
}

.pet-picker-size-note {
  margin-left: 4px;
  color: var(--muted);
  opacity: 0.85;
}

.pet-picker-item--local-only .pet-picker-size {
  opacity: 0.7;
}

.pet-picker-kind {
  font-size: 0.75rem;
  color: var(--muted);
}
</style>
