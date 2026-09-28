import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { loadUnityClipWithModule } from "./unity-clip.js";
import type { Clip } from "./types.js";

let modulePromise: Promise<typeof import("@arkntools/unity-js")> | undefined;
function unityModule(): Promise<typeof import("@arkntools/unity-js")> {
  if (!modulePromise) {
    const require = createRequire(import.meta.url);
    // unity-js 5.1 发布的相对导入路径没有文件扩展名。此兼容处理仅作用于
    // unity-js 包，并在模块依赖图加载完成后注销。
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        try {
          return nextResolve(specifier, context);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            !context.parentURL?.includes("/@arkntools/unity-js/") ||
            !specifier.startsWith(".") ||
            !["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(
              code ?? "",
            )
          )
            throw error;
          for (const suffix of [".js", "/index.js"]) {
            try {
              return nextResolve(`${specifier}${suffix}`, context);
            } catch {
              /* 再尝试另一种 TypeScript 编译输出路径。 */
            }
          }
          throw error;
        }
      },
    });
    modulePromise = import(
      pathToFileURL(require.resolve("@arkntools/unity-js")).href
    ).finally(() => hooks.deregister());
  }
  return modulePromise;
}

/** 加载一个宠物动画 bundle 及其共享材质依赖，无需浏览器环境。 */
export async function loadUnityClip(
  bytes: Uint8Array,
  sharedBytes: Uint8Array,
): Promise<Clip> {
  return loadUnityClipWithModule(bytes, sharedBytes, await unityModule());
}
