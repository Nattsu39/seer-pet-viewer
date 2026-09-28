<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { PetAnimIndex, PetAnimIndexEntry } from "../lib/pet-anim-index";
import { isRemoteBundleEnabled } from "../lib/remote-bundle";
import { usePetAnimIndex } from "../composables/usePetAnimIndex";
import PetPickerItem from "./PetPickerItem.vue";

const props = defineProps<{
  loading?: boolean;
  initialQuery?: string;
}>();

const emit = defineEmits<{
  select: [entry: PetAnimIndexEntry, index: PetAnimIndex];
}>();

const MAX_RESULTS = 200;
const DEBOUNCE_MS = 150;

const { index, indexError, indexLoading, retryIndexLoad } = usePetAnimIndex();
const remoteEnabled = isRemoteBundleEnabled();

const query = ref(props.initialQuery ?? "");
const debouncedQuery = ref(query.value);
const kindFilter = ref<"all" | "swf" | "spine">("all");
const listRef = ref<HTMLElement | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  query,
  (value) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedQuery.value = value;
    }, DEBOUNCE_MS);
  },
  { immediate: true },
);

watch(
  () => props.initialQuery,
  (value) => {
    if (value) query.value = value;
  },
);

const filteredResult = computed(() => {
  if (!index.value) return { entries: [] as PetAnimIndexEntry[], truncated: 0 };
  const q = debouncedQuery.value.trim();
  if (!q) return { entries: [], truncated: 0 };

  const matched = index.value.entries.filter((entry) => {
    if (kindFilter.value !== "all" && entry.kind !== kindFilter.value) {
      return false;
    }
    if (/^\d+$/.test(q)) {
      return String(entry.id).startsWith(q);
    }
    return entry.name.toLowerCase().includes(q.toLowerCase());
  });

  const truncated = Math.max(0, matched.length - MAX_RESULTS);
  return {
    entries: matched.slice(0, MAX_RESULTS),
    truncated,
  };
});

const filteredEntries = computed(() => filteredResult.value.entries);
const truncatedCount = computed(() => filteredResult.value.truncated);
const hasQuery = computed(() => debouncedQuery.value.trim().length > 0);
const isSearching = computed(
  () => query.value.trim() !== debouncedQuery.value.trim(),
);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: filteredEntries.value.length,
    getScrollElement: () => listRef.value,
    estimateSize: () => 45,
    overscan: 8,
  })),
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());

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
      <p v-else-if="indexError" class="pet-picker-error-block">
        <span class="pet-picker-error">{{ indexError }}</span>
        <button type="button" class="pet-picker-retry" @click="retryIndexLoad">
          重试
        </button>
      </p>
      <p v-else-if="indexLoading" class="pet-picker-meta">正在加载资源索引…</p>
    </div>

    <div v-if="index" class="pet-picker-controls">
      <input
        v-model="query"
        type="search"
        class="pet-picker-search"
        placeholder="搜索精灵 ID 或名称…"
        :disabled="loading"
        enterkeyhint="search"
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

    <div v-if="index" class="pet-picker-list-wrap">
      <p v-if="!hasQuery" class="pet-picker-hint">
        请输入精灵 ID 进行搜索（支持前缀匹配）
      </p>
      <p v-else-if="isSearching" class="pet-picker-hint">搜索中…</p>
      <p
        v-else-if="hasQuery && filteredEntries.length === 0"
        class="pet-picker-empty"
      >
        没有匹配的资源
      </p>
      <div
        v-else-if="filteredEntries.length > 0"
        ref="listRef"
        class="pet-picker-list"
      >
        <div
          class="pet-picker-list-inner"
          :style="{ height: `${virtualizer.getTotalSize()}px` }"
        >
          <div
            v-for="row in virtualRows"
            :key="filteredEntries[row.index]!.name"
            class="pet-picker-row"
            :style="{
              height: `${row.size}px`,
              transform: `translateY(${row.start}px)`,
            }"
          >
            <PetPickerItem
              :entry="filteredEntries[row.index]!"
              :disabled="loading"
              @select="onSelect"
            />
          </div>
        </div>
      </div>
      <p v-if="truncatedCount > 0" class="pet-picker-truncated">
        还有 {{ truncatedCount }} 条结果，请缩小搜索范围
      </p>
      <p class="pet-picker-footnote">
        小于 5 MB 通过同域代理加载；已镜像的大文件从 GitHub
        图床（jsDelivr）加载；未镜像的大文件请本地导入。
      </p>
    </div>
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
  display: flex;
  flex-direction: column;
  min-height: 0;
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
  color: var(--error);
}

.pet-picker-error-block {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0;
  flex-wrap: wrap;
}

.pet-picker-error-block .pet-picker-error {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  line-height: 1.45;
}

.pet-picker-retry {
  flex-shrink: 0;
  min-height: 32px;
  padding: 4px 12px;
  font-size: 0.82rem;
}

.pet-picker-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  flex-shrink: 0;
}

.pet-picker-search {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 1rem;
  min-height: 44px;
}

.pet-picker-filters {
  display: flex;
  gap: 8px;
}

.filter-btn {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 0.82rem;
  cursor: pointer;
  min-height: 36px;
}

.filter-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.pet-picker-list-wrap {
  margin-top: 12px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pet-picker-hint,
.pet-picker-empty,
.pet-picker-truncated {
  margin: 0;
  padding: 16px;
  text-align: center;
  color: var(--muted);
  font-size: 0.88rem;
}

.pet-picker-truncated {
  padding: 8px 12px;
  font-size: 0.82rem;
  border-top: 1px solid var(--border);
}

.pet-picker-footnote {
  margin: 8px 0 0;
  padding: 0 4px;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--muted);
}

.pet-picker-list {
  flex: 1;
  min-height: 120px;
  max-height: min(50vh, 400px);
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.pet-picker-list-inner {
  position: relative;
  width: 100%;
}

.pet-picker-row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

@media (max-width: 768px) {
  .pet-picker {
    max-width: none;
    margin-bottom: 12px;
    flex: 1;
  }

  .pet-picker-list {
    max-height: none;
    flex: 1;
  }
}
</style>
