<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type {
  PetAnimIndex,
  PetAnimIndexEntry,
} from "../lib/pet-anim-index";
import { loadPetAnimIndex } from "../lib/pet-anim-index";
import { isRemoteBundleEnabled } from "../lib/remote-bundle";

const props = defineProps<{
  loading?: boolean;
}>();

const emit = defineEmits<{
  select: [entry: PetAnimIndexEntry, index: PetAnimIndex];
}>();

const index = ref<PetAnimIndex | null>(null);
const indexError = ref<string | null>(null);
const query = ref("");
const kindFilter = ref<"all" | "swf" | "spine">("all");

const remoteEnabled = isRemoteBundleEnabled();

onMounted(async () => {
  if (!remoteEnabled) return;
  try {
    index.value = await loadPetAnimIndex();
  } catch (e) {
    indexError.value = e instanceof Error ? e.message : String(e);
  }
});

const filteredEntries = computed(() => {
  if (!index.value) return [];
  const q = query.value.trim();
  return index.value.entries.filter((entry) => {
    if (kindFilter.value !== "all" && entry.kind !== kindFilter.value) {
      return false;
    }
    if (!q) return true;
    if (/^\d+$/.test(q)) {
      return String(entry.id).includes(q);
    }
    return entry.name.toLowerCase().includes(q.toLowerCase());
  });
});

function kindLabel(kind: PetAnimIndexEntry["kind"]) {
  return kind === "swf" ? "SWF" : "Spine";
}

function variantLabel(entry: PetAnimIndexEntry) {
  return entry.variant === "small" ? "（小）" : "";
}

function onSelect(entry: PetAnimIndexEntry) {
  if (!index.value || props.loading) return;
  emit("select", entry, index.value);
}
</script>

<template>
  <section v-if="remoteEnabled" class="pet-picker">
    <div class="pet-picker-header">
      <h2>远程精灵资源</h2>
      <p v-if="index" class="pet-picker-meta">
        清单版本 {{ index.version }} · {{ index.entries.length }} 条
      </p>
      <p v-else-if="indexError" class="pet-picker-error">{{ indexError }}</p>
      <p v-else class="pet-picker-meta">正在加载资源索引…</p>
    </div>

    <div v-if="index" class="pet-picker-controls">
      <input
        v-model="query"
        type="search"
        class="pet-picker-search"
        placeholder="搜索精灵 ID 或名称…"
        :disabled="loading"
      />
      <div class="pet-picker-filters">
        <button
          type="button"
          class="filter-btn"
          :class="{ active: kindFilter === 'all' }"
          :disabled="loading"
          @click="kindFilter = 'all'"
        >
          全部
        </button>
        <button
          type="button"
          class="filter-btn"
          :class="{ active: kindFilter === 'swf' }"
          :disabled="loading"
          @click="kindFilter = 'swf'"
        >
          SWF
        </button>
        <button
          type="button"
          class="filter-btn"
          :class="{ active: kindFilter === 'spine' }"
          :disabled="loading"
          @click="kindFilter = 'spine'"
        >
          Spine
        </button>
      </div>
    </div>

    <ul v-if="index" class="pet-picker-list">
      <li v-if="filteredEntries.length === 0" class="pet-picker-empty">
        没有匹配的资源
      </li>
      <li v-for="entry in filteredEntries" :key="entry.name">
        <button
          type="button"
          class="pet-picker-item"
          :disabled="loading"
          @click="onSelect(entry)"
        >
          <span class="pet-picker-id">#{{ entry.id }}</span>
          <span class="pet-picker-name">{{ entry.name }}{{ variantLabel(entry) }}</span>
          <span class="pet-picker-kind">{{ kindLabel(entry.kind) }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.pet-picker {
  width: 100%;
  max-width: 560px;
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  text-align: left;
}

.pet-picker-header h2 {
  margin: 0 0 4px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
}

.pet-picker-meta {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
}

.pet-picker-error {
  margin: 0;
  font-size: 0.82rem;
  color: var(--error);
}

.pet-picker-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.pet-picker-search {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.9rem;
}

.pet-picker-filters {
  display: flex;
  gap: 8px;
}

.filter-btn {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 0.82rem;
  cursor: pointer;
}

.filter-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.pet-picker-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.pet-picker-empty {
  padding: 16px;
  text-align: center;
  color: var(--muted);
  font-size: 0.88rem;
}

.pet-picker-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
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

.pet-picker-kind {
  font-size: 0.75rem;
  color: var(--muted);
}
</style>
