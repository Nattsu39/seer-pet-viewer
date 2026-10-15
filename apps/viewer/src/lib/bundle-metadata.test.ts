import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readBundleMetadata } from "./bundle-metadata";
import type { BundleMetadataRequest } from "./bundle-metadata-protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn(
    (_request: BundleMetadataRequest, _transfer: Transferable[]) => {},
  );

  constructor() {
    FakeWorker.instances.push(this);
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

it("copies the retained bundle and terminates the worker after detection", async () => {
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  const result = readBundleMetadata(
    "detect",
    buffer,
    new AbortController().signal,
  );
  const worker = FakeWorker.instances[0];
  const [request, transfer] = worker.postMessage.mock.calls[0];
  expect(request.type).toBe("detect");
  expect(request.buffer).not.toBe(buffer);
  expect(new Uint8Array(request.buffer)).toEqual(new Uint8Array(buffer));
  expect(transfer).toEqual([request.buffer]);
  worker.onmessage?.({
    data: { ok: true, type: "detect", result: "swf" },
  } as MessageEvent);
  await expect(result).resolves.toBe("swf");
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("returns material snapshots without loading a parser on the main thread", async () => {
  const result = readBundleMetadata(
    "materials",
    new ArrayBuffer(0),
    new AbortController().signal,
  );
  const response = { count: 0, warnings: [], materials: {} };
  const worker = FakeWorker.instances[0];
  worker.onmessage?.({
    data: { ok: true, type: "materials", result: response },
  } as MessageEvent);
  await expect(result).resolves.toEqual(response);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("terminates cancelled work without affecting another request", async () => {
  const controller = new AbortController();
  const first = readBundleMetadata(
    "detect",
    new ArrayBuffer(0),
    controller.signal,
  );
  const second = readBundleMetadata(
    "detect",
    new ArrayBuffer(0),
    new AbortController().signal,
  );
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  const worker = FakeWorker.instances[1];
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.onmessage?.({
    data: { ok: true, type: "detect", result: "spine" },
  } as MessageEvent);
  await expect(second).resolves.toBe("spine");
});

it.each(["error", "messageerror", "parse"])(
  "rejects and releases workers on %s failure",
  async (failure) => {
    const result = readBundleMetadata(
      "detect",
      new ArrayBuffer(0),
      new AbortController().signal,
    );
    const rejected = expect(result).rejects.toBeInstanceOf(Error);
    const worker = FakeWorker.instances[0];
    if (failure === "error")
      worker.onerror?.({ message: "crash" } as ErrorEvent);
    else if (failure === "messageerror") worker.onmessageerror?.();
    else
      worker.onmessage?.({
        data: { ok: false, error: "bad bundle" },
      } as MessageEvent);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  },
);
