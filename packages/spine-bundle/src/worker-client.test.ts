import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ build: vi.fn(), close: vi.fn() }));
vi.mock("./clip-data.js", () => ({
  buildSpineClipData: state.build,
  closeSpineClipData: state.close,
}));
class FakeWorker {
  static instances: FakeWorker[] = [];
  static sendError = false;
  onmessage: ((event: MessageEvent) => Promise<void>) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  ids: number[] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: { id: number }) {
    if (FakeWorker.sendError) throw new Error("send failed");
    this.ids.push(message.id);
  }
  reply(id: number) {
    return this.onmessage?.({
      data: { id, ok: true, textures: [], skeletonBytes: new ArrayBuffer(0) },
    } as MessageEvent);
  }
}
let client: typeof import("./worker-client.js");
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
  FakeWorker.instances = [];
  FakeWorker.sendError = false;
  state.build.mockReset().mockResolvedValue({ textures: new Map() });
  state.close.mockReset();
  client = await import("./worker-client.js");
});
afterEach(() => {
  client.terminateSpineParserWorker();
  vi.unstubAllGlobals();
});
it("cancels one request without killing its neighbour", async () => {
  const controller = new AbortController();
  const a = client.parseSpineBundleInWorker(new ArrayBuffer(0), "a", {
    signal: controller.signal,
  });
  const b = client.parseSpineBundleInWorker(new ArrayBuffer(0), "b");
  const failed = expect(a).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await failed;
  const worker = FakeWorker.instances[0];
  expect(worker.terminate).not.toHaveBeenCalled();
  await worker.reply(worker.ids[1]);
  await expect(b).resolves.toBeDefined();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it.each(["error", "messageerror", "terminate"])(
  "settles all requests on %s and recreates worker",
  async (failure) => {
    const a = client.parseSpineBundleInWorker(new ArrayBuffer(0), "a"),
      b = client.parseSpineBundleInWorker(new ArrayBuffer(0), "b");
    const results = Promise.allSettled([a, b]);
    const worker = FakeWorker.instances[0];
    if (failure === "error")
      worker.onerror?.({ message: "crash" } as ErrorEvent);
    else if (failure === "messageerror") worker.onmessageerror?.();
    else client.terminateSpineParserWorker();
    expect((await results).map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    const next = client.parseSpineBundleInWorker(new ArrayBuffer(0), "c");
    expect(FakeWorker.instances).toHaveLength(2);
    const replacement = FakeWorker.instances[1];
    await replacement.reply(replacement.ids[0]);
    await next;
  },
);
it("rejects send and bitmap construction failures", async () => {
  FakeWorker.sendError = true;
  await expect(
    client.parseSpineBundleInWorker(new ArrayBuffer(0), "a"),
  ).rejects.toThrow("send failed");
  FakeWorker.sendError = false;
  state.build.mockRejectedValueOnce(new Error("bitmap failed"));
  const next = client.parseSpineBundleInWorker(new ArrayBuffer(0), "b");
  const rejected = expect(next).rejects.toThrow("bitmap failed");
  const worker = FakeWorker.instances.at(-1)!;
  await worker.reply(worker.ids[0]);
  await rejected;
});
it("closes a late clip when cancelled during bitmap construction", async () => {
  let finish!: (clip: unknown) => void;
  state.build.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const controller = new AbortController(),
    promise = client.parseSpineBundleInWorker(new ArrayBuffer(0), "a", {
      signal: controller.signal,
    });
  const worker = FakeWorker.instances[0],
    reply = worker.reply(worker.ids[0]);
  const failed = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await failed;
  const clip = { textures: new Map() };
  finish(clip);
  await reply;
  expect(state.close).toHaveBeenCalledWith(clip);
});
