import { computed, ref, watch } from "vue";
import { useBreakpoint } from "./useBreakpoint";

export type ThemePreference = "system" | "light" | "dark";
export type ToolbarPosition = "bottom" | "side";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "seer-viewer-settings";

interface ViewerSettings {
  themePreference: ThemePreference;
  toolbarPosition: ToolbarPosition;
  autoImportSharedMaterials: boolean;
}

const THEME_CYCLE: ThemePreference[] = ["system", "light", "dark"];

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "跟随系统",
  light: "亮色",
  dark: "暗色",
};

const NEXT_THEME_LABELS: Record<ThemePreference, string> = {
  system: "亮色",
  light: "暗色",
  dark: "跟随系统",
};

function readStored(): ViewerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        themePreference: "system",
        toolbarPosition: "bottom",
        autoImportSharedMaterials: true,
      };
    }
    const parsed = JSON.parse(raw) as Partial<ViewerSettings>;
    return {
      themePreference:
        parsed.themePreference === "light" ||
        parsed.themePreference === "dark" ||
        parsed.themePreference === "system"
          ? parsed.themePreference
          : "system",
      toolbarPosition:
        parsed.toolbarPosition === "side" ? "side" : "bottom",
      autoImportSharedMaterials: parsed.autoImportSharedMaterials !== false,
    };
  } catch {
    return {
      themePreference: "system",
      toolbarPosition: "bottom",
      autoImportSharedMaterials: true,
    };
  }
}

function writeStored(settings: ViewerSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return getSystemTheme();
  return preference;
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function getCanvasBackgroundColor(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--canvas-bg")
    .trim();
  if (!raw) return 0x12121f;
  if (raw.startsWith("#")) {
    return Number.parseInt(raw.slice(1), 16);
  }
  return 0x12121f;
}

const stored = readStored();
const themePreference = ref<ThemePreference>(stored.themePreference);
const toolbarPosition = ref<ToolbarPosition>(stored.toolbarPosition);
const autoImportSharedMaterials = ref(stored.autoImportSharedMaterials);
const resolvedTheme = ref<ResolvedTheme>(resolveTheme(stored.themePreference));

applyResolvedTheme(resolvedTheme.value);

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;
let settingsInitialized = false;

function persist(): void {
  writeStored({
    themePreference: themePreference.value,
    toolbarPosition: toolbarPosition.value,
    autoImportSharedMaterials: autoImportSharedMaterials.value,
  });
}

function syncResolvedTheme(): void {
  const next = resolveTheme(themePreference.value);
  if (resolvedTheme.value === next) return;
  resolvedTheme.value = next;
  applyResolvedTheme(next);
}

function bindSystemThemeListener(): void {
  if (typeof window === "undefined") return;
  mediaQuery ??= window.matchMedia("(prefers-color-scheme: dark)");
  mediaListener ??= () => {
    if (themePreference.value === "system") syncResolvedTheme();
  };
  mediaQuery.addEventListener("change", mediaListener);
}

export function initViewerSettings(): void {
  if (settingsInitialized) return;
  settingsInitialized = true;
  bindSystemThemeListener();
}

export function useViewerSettings() {
  initViewerSettings();
  const { isMobile } = useBreakpoint();

  watch(themePreference, () => {
    syncResolvedTheme();
    persist();
  });

  watch(toolbarPosition, persist);
  watch(autoImportSharedMaterials, persist);

  const themeLabel = computed(() => THEME_LABELS[themePreference.value]);
  const nextThemeLabel = computed(
    () => NEXT_THEME_LABELS[themePreference.value],
  );
  const toolbarLabel = computed(() =>
    toolbarPosition.value === "bottom" ? "底部" : "侧边",
  );
  const nextToolbarLabel = computed(() =>
    toolbarPosition.value === "bottom" ? "侧边" : "底部",
  );
  const effectiveToolbarPosition = computed<ToolbarPosition>(() =>
    isMobile.value ? "bottom" : toolbarPosition.value,
  );

  function cycleTheme(): void {
    const index = THEME_CYCLE.indexOf(themePreference.value);
    themePreference.value = THEME_CYCLE[(index + 1) % THEME_CYCLE.length]!;
  }

  function toggleToolbarPosition(): void {
    toolbarPosition.value =
      toolbarPosition.value === "bottom" ? "side" : "bottom";
  }

  return {
    themePreference,
    toolbarPosition,
    autoImportSharedMaterials,
    effectiveToolbarPosition,
    isMobile,
    resolvedTheme,
    themeLabel,
    nextThemeLabel,
    toolbarLabel,
    nextToolbarLabel,
    cycleTheme,
    toggleToolbarPosition,
  };
}
