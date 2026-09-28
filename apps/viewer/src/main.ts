import { Buffer } from "buffer";
import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { initViewerSettings } from "./composables/useViewerSettings";

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;

initViewerSettings();

function showBootError(message: string) {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = `<div style="padding:24px;font-family:system-ui,sans-serif;color:#ff6b6b;background:#1a1a2e;min-height:100vh">
    <h2 style="color:#e8e8f0;margin:0 0 12px">应用加载失败</h2>
    <pre style="white-space:pre-wrap;word-break:break-word">${message}</pre>
  </div>`;
}

try {
  createApp(App).mount("#app");
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(error);
  showBootError(message);
}

window.addEventListener("error", (event) => {
  if (document.getElementById("app")?.childElementCount) return;
  showBootError(event.error?.stack ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  if (document.getElementById("app")?.childElementCount) return;
  const reason = event.reason;
  const message =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  showBootError(message);
});
