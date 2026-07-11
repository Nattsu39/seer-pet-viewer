import { onMounted, onUnmounted, ref } from "vue";

/** 追踪 visualViewport 与布局视口底部的差值，用于避开移动端浏览器地址栏等区域 */
export function useVisualViewportBottomInset() {
  const bottomInset = ref(0);

  function update() {
    const vv = window.visualViewport;
    if (!vv) {
      bottomInset.value = 0;
      return;
    }
    const layoutHeight = window.innerHeight;
    const visibleBottom = vv.offsetTop + vv.height;
    bottomInset.value = Math.max(0, Math.round(layoutHeight - visibleBottom));
  }

  onMounted(() => {
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
  });

  onUnmounted(() => {
    window.visualViewport?.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
  });

  return { bottomInset };
}
