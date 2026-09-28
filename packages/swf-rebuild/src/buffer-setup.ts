import { Buffer } from "buffer";

// unity-js 要求浏览器 Worker 环境中存在全局 Buffer。
const globals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
globals.Buffer ??= Buffer;
