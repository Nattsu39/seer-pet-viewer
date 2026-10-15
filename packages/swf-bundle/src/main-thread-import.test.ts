import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("loads the browser entry without synchronously compiling large WASM modules", async () => {
  const NativeModule = WebAssembly.Module;
  const restrictedModule = new Proxy(NativeModule, {
    construct(target, args) {
      const bytes = args[0] as BufferSource;
      if (bytes.byteLength > 4096) {
        throw new RangeError(
          "WebAssembly.Module(): synchronous compilation on the main thread is limited to 4KB",
        );
      }
      return Reflect.construct(target, args);
    },
  });
  vi.stubGlobal("WebAssembly", {
    ...WebAssembly,
    Module: restrictedModule,
  });

  const entry = await import("./index.js");
  expect(entry.ensureSwfClipAtlas).toBeTypeOf("function");
});
