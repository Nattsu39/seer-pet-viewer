import { onUnmounted, watch, type Ref } from "vue";
import { lockBodyScroll, unlockBodyScroll } from "../lib/bodyScrollLock";

export function useHistoryOverlay(open: Ref<boolean>, historyKey: string) {
  let suppressPopstate = false;

  function openOverlay() {
    if (open.value) return;
    open.value = true;
    history.pushState({ [historyKey]: true }, "");
  }

  function closeOverlay(fromPopstate = false) {
    if (!open.value) return;
    open.value = false;
    if (!fromPopstate && history.state?.[historyKey]) {
      suppressPopstate = true;
      history.back();
    }
  }

  function onPopstate() {
    if (suppressPopstate) {
      suppressPopstate = false;
      return;
    }
    if (open.value) {
      closeOverlay(true);
    }
  }

  watch(open, (visible) => {
    if (visible) lockBodyScroll();
    else unlockBodyScroll();
  });

  window.addEventListener("popstate", onPopstate);

  onUnmounted(() => {
    window.removeEventListener("popstate", onPopstate);
    if (open.value) {
      open.value = false;
      unlockBodyScroll();
      if (history.state?.[historyKey]) {
        suppressPopstate = true;
        history.back();
      }
    }
  });

  return { openOverlay, closeOverlay };
}
