---
"@seer-pet-anim/spine-bundle": patch
"@seer-pet-anim/swf-bundle": patch
---

修复浏览器导入包入口时提前同步编译 Unity WASM 的问题，避免触发旧版 WebView 的主线程 4KB 编译限制。

Spine 包入口改为按需加载解析器，保留现有 API。
SWF 包将图集恢复逻辑与解析器拆分，并从根入口导出，使浏览器可以通过 Worker 恢复图集而不在主线程加载 WASM。
