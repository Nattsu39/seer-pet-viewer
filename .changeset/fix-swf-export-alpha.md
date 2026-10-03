---
"@seer-pet-anim/swf-renderer": patch
"@seer-pet-anim/anim-export": patch
---

修复 SWF 导出的 PNG 序列在叠加背景时，半透明区域颜色变暗的问题。导出时将 WebGL 读回的预乘 Alpha 像素还原为直通 Alpha，避免图片合成时重复应用透明度。

共享反预乘函数支持 `Uint8Array` 和 `Uint8ClampedArray`，并通过 `capture` 子路径导出，供 SWF 导出管线复用。
