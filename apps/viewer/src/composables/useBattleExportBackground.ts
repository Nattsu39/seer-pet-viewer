import { computed, ref, watch, type Ref } from "vue";
import type { ViewerExportFormat } from "./useAnimationExport";

type BackgroundMode = "transparent" | "solid";

interface BattleBackgroundSettings {
  mode: BackgroundMode;
  color: string;
}

const STORAGE_KEY = "seer-battle-export-background";
const DEFAULT_COLOR = "#12121f";

function readSettings(): BattleBackgroundSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      mode: stored?.mode === "solid" ? "solid" : "transparent",
      color:
        typeof stored?.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(stored.color)
          ? stored.color.toLowerCase()
          : DEFAULT_COLOR,
    };
  } catch {
    return { mode: "transparent", color: DEFAULT_COLOR };
  }
}

export function useBattleExportBackground(format: Ref<ViewerExportFormat>) {
  const stored = readSettings();
  const mode = ref<BackgroundMode>(stored.mode);
  const backgroundColor = ref(stored.color);

  // MP4 requires a solid background without replacing the saved preference.
  const backgroundMode = computed({
    get: () => (format.value === "mp4" ? "solid" : mode.value),
    set: (value: BackgroundMode) => {
      mode.value = value;
    },
  });
  const backgroundColorNumber = computed(() =>
    Number.parseInt(backgroundColor.value.slice(1), 16),
  );

  watch([mode, backgroundColor], ([nextMode, color]) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mode: nextMode, color }),
      );
    } catch {
      // Keep the controls usable when browser storage is unavailable.
    }
  });

  function resetBackground(): void {
    mode.value = "transparent";
    backgroundColor.value = DEFAULT_COLOR;
  }

  return {
    backgroundMode,
    backgroundColor,
    backgroundColorNumber,
    resetBackground,
  };
}
