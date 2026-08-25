import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { encodeParsedSwfBundle, encodeSwfBundleFrames } from "./worker-protocol.js";
import type { ParsedSwfBundle } from "./types.js";

const testState = vi.hoisted(() => ({
  events: [] as string[],
  atlasPixelsToBitmap: vi.fn(),
}));

vi.mock("./atlas.js", () => ({
  atlasPixelsToBitmap: testState.atlasPixelsToBitmap,
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  static constructError: Error | null = null;
  static nextPostError: Error | null = null;
  postError: Error | null = null;
  readonly messages: Array<{ data: unknown; transfer: Transferable[] }> = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;

  constructor() {
    if (FakeWorker.constructError) throw FakeWorker.constructError;
    this.postError = FakeWorker.nextPostError;
    FakeWorker.nextPostError = null;
    FakeWorker.instances.push(this);
  }

  postMessage(data: unknown, transfer: Transferable[] = []): void {
    this.messages.push({ data, transfer });
    if (this.postError) throw this.postError;
  }

  terminate(): void {
    this.terminated = true;
    testState.events.push("terminate");
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  emitMessageError(): void {
    this.onmessageerror?.({} as MessageEvent);
  }
}

let client: typeof import("./worker-client.js");

function makeBundle(): ParsedSwfBundle {
  return {
    petId: 7,
    name: "pet",
    frameRate: 24,
    atlasWidth: 2,
    atlasHeight: 1,
    atlasPixels: {
      width: 2,
      height: 1,
      rgba: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]),
    },
    materialWarnings: [],
    sequences: [
      {
        name: "standby",
        frames: [
          {
            labels: [],
            mesh: {
              positions: new Float32Array([1, 2]),
              uvs: new Float32Array([0, 1]),
              addColors: new Float32Array([1, 1]),
              mulColors: new Float32Array([1, 1]),
              indices: new Uint16Array([0, 1]),
              subMeshes: [],
            },
          },
        ],
      },
    ],
  };
}

function successMessage(id: number) {
  const encoded = encodeParsedSwfBundle(makeBundle());
  return {
    id,
    ok: true,
    descriptor: encoded.descriptor,
    floatBuffer: encoded.floatBuffer,
    uintBuffer: encoded.uintBuffer,
    atlasBuffer: encoded.atlasBuffer,
  };
}

function bitmapMessage(id: number, atlasBitmap: ImageBitmap) {
  const encoded = encodeSwfBundleFrames(makeBundle());
  return {
    id,
    ok: true,
    descriptor: encoded.descriptor,
    floatBuffer: encoded.floatBuffer,
    uintBuffer: encoded.uintBuffer,
    atlasBitmap,
  };
}

function requestBuffer(): ArrayBuffer {
  return new ArrayBuffer(16);
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  FakeWorker.instances = [];
  FakeWorker.constructError = null;
  FakeWorker.nextPostError = null;
  testState.events = [];
  testState.atlasPixelsToBitmap.mockReset();
  testState.atlasPixelsToBitmap.mockImplementation(async () => {
    testState.events.push("bitmap");
    return {
      bitmap: {} as ImageBitmap,
      width: 2,
      height: 1,
      originalWidth: 2,
      originalHeight: 1,
      scaled: false,
    };
  });
  vi.resetModules();
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  client = await import("./worker-client.js");
});

afterEach(() => {
  client.terminateParserWorker();
});

describe("parseBundleInWorker lifecycle", () => {
  it("adopts the worker-built atlas bitmap without decoding pixels on the main thread", async () => {
    const atlasBitmap = { width: 2, height: 1 } as ImageBitmap;
    const result = client.parseBundleInWorker(requestBuffer(), "bitmap");
    const parser = FakeWorker.instances[0]!;
    parser.emitMessage(bitmapMessage(1, atlasBitmap));

    const clip = await result;
    expect(clip.atlas).toBe(atlasBitmap);
    expect(clip.atlasWidth).toBe(2);
    expect(clip.sequences[0]!.frames[0]!.mesh.positions[0]).toBe(1);
    expect(testState.atlasPixelsToBitmap).not.toHaveBeenCalled();
    expect(parser.terminated).toBe(true);
  });

  it("rejects a response that carries no atlas payload", async () => {
    const result = client.parseBundleInWorker(requestBuffer(), "no-atlas");
    const parser = FakeWorker.instances[0]!;
    const { atlasBuffer: _atlasBuffer, ...withoutAtlas } = successMessage(1);
    parser.emitMessage(withoutAtlas);

    await expect(result).rejects.toThrow("解析 Worker 未返回图集数据");
  });

  it("shares one worker for two concurrent requests and terminates before bitmap decoding", async () => {
    const source = requestBuffer();
    const first = client.parseBundleInWorker(source, "first");
    const second = client.parseBundleInWorker(source, "second");
    const parser = FakeWorker.instances[0]!;

    expect(FakeWorker.instances).toHaveLength(1);
    expect(parser.messages).toHaveLength(2);
    expect(parser.messages[0]!.transfer).toHaveLength(1);
    expect(source.byteLength).toBe(16);

    parser.emitMessage(successMessage(1));
    const firstClip = await first;
    expect(firstClip.sequences[0]!.frames[0]!.mesh.positions[0]).toBe(1);
    expect(parser.terminated).toBe(false);

    parser.emitMessage(successMessage(2));
    const secondClip = await second;
    await flushAsyncWork();
    expect(secondClip.petId).toBe(7);
    expect(parser.terminated).toBe(true);
    expect(testState.events).toEqual(["bitmap", "terminate", "bitmap"]);
  });

  it("settles one parse error and recovers with a new worker", async () => {
    const first = client.parseBundleInWorker(requestBuffer(), "bad");
    const parser = FakeWorker.instances[0]!;
    parser.emitMessage({ id: 1, ok: false, error: "坏 bundle" });

    await expect(first).rejects.toThrow("坏 bundle");
    await flushAsyncWork();
    expect(parser.terminated).toBe(true);

    const second = client.parseBundleInWorker(requestBuffer(), "good");
    const replacement = FakeWorker.instances[1]!;
    replacement.emitMessage(successMessage(2));
    await expect(second).resolves.toMatchObject({ petId: 7 });
  });

  it("rejects all active requests on worker error and ignores stale events", async () => {
    const first = client.parseBundleInWorker(requestBuffer(), "first");
    const second = client.parseBundleInWorker(requestBuffer(), "second");
    const oldWorker = FakeWorker.instances[0]!;
    oldWorker.emitError("worker crashed");

    await expect(first).rejects.toThrow("worker crashed");
    await expect(second).rejects.toThrow("worker crashed");
    expect(oldWorker.terminated).toBe(true);

    const third = client.parseBundleInWorker(requestBuffer(), "third");
    const newWorker = FakeWorker.instances[1]!;
    oldWorker.emitMessage(successMessage(3));
    newWorker.emitMessage(successMessage(3));
    await expect(third).resolves.toMatchObject({ petId: 7 });
  });

  it("creates and terminates a fresh worker for three serial requests", async () => {
    for (let id = 1; id <= 3; id++) {
      const result = client.parseBundleInWorker(requestBuffer(), `pet-${id}`);
      const parser = FakeWorker.instances[id - 1]!;
      parser.emitMessage(successMessage(id));
      await expect(result).resolves.toMatchObject({ petId: 7 });
      expect(parser.terminated).toBe(true);
    }
    expect(FakeWorker.instances).toHaveLength(3);
    expect(testState.events.filter((event) => event === "terminate")).toHaveLength(3);
  });

  it("rejects active promises on explicit termination and ignores late responses", async () => {
    const pending = client.parseBundleInWorker(requestBuffer(), "pending");
    const parser = FakeWorker.instances[0]!;

    client.terminateParserWorker();
    await expect(pending).rejects.toThrow();
    expect(parser.terminated).toBe(true);
    parser.emitMessage(successMessage(1));

    const next = client.parseBundleInWorker(requestBuffer(), "next");
    const replacement = FakeWorker.instances[1]!;
    replacement.emitMessage(successMessage(2));
    await expect(next).resolves.toMatchObject({ petId: 7 });
  });

  it("rejects an active promise while bitmap conversion is still in flight", async () => {
    let releaseBitmap!: (value: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
      originalWidth: number;
      originalHeight: number;
      scaled: boolean;
    }) => void;
    testState.atlasPixelsToBitmap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseBitmap = resolve;
        }),
    );
    const pending = client.parseBundleInWorker(requestBuffer(), "decode");
    const parser = FakeWorker.instances[0]!;
    parser.emitMessage(successMessage(1));
    await flushAsyncWork();

    client.terminateParserWorker();
    await expect(pending).rejects.toThrow("解析 Worker 已终止");
    releaseBitmap({
      bitmap: {} as ImageBitmap,
      width: 2,
      height: 1,
      originalWidth: 2,
      originalHeight: 1,
      scaled: false,
    });
    await flushAsyncWork();
  });

  it("rejects bitmap and protocol decode failures", async () => {
    testState.atlasPixelsToBitmap.mockRejectedValueOnce(new Error("bitmap failed"));
    const bitmapFailure = client.parseBundleInWorker(requestBuffer(), "bitmap");
    const bitmapWorker = FakeWorker.instances[0]!;
    bitmapWorker.emitMessage(successMessage(1));
    await expect(bitmapFailure).rejects.toThrow("bitmap failed");

    const decodeFailure = client.parseBundleInWorker(requestBuffer(), "decode");
    const decodeWorker = FakeWorker.instances[1]!;
    const valid = successMessage(2);
    decodeWorker.emitMessage({
      ...valid,
      floatBuffer: new ArrayBuffer(1),
    });
    await expect(decodeFailure).rejects.toThrow();
  });

  it("recovers from synchronous worker construction and postMessage errors", async () => {
    FakeWorker.constructError = new Error("constructor failed");
    const constructFailure = client.parseBundleInWorker(requestBuffer(), "construct");
    await expect(constructFailure).rejects.toThrow("constructor failed");

    FakeWorker.constructError = null;
    FakeWorker.nextPostError = new Error("post failed");
    const postFailure = client.parseBundleInWorker(requestBuffer(), "post");
    const brokenWorker = FakeWorker.instances[0]!;
    await expect(postFailure).rejects.toThrow("post failed");
    expect(brokenWorker.terminated).toBe(true);

    const recovered = client.parseBundleInWorker(requestBuffer(), "recovered");
    const healthyWorker = FakeWorker.instances[1]!;
    healthyWorker.emitMessage(successMessage(3));
    await expect(recovered).resolves.toMatchObject({ petId: 7 });
  });

  it("rejects every request on messageerror", async () => {
    const first = client.parseBundleInWorker(requestBuffer(), "first");
    const second = client.parseBundleInWorker(requestBuffer(), "second");
    const parser = FakeWorker.instances[0]!;
    parser.emitMessageError();

    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(parser.terminated).toBe(true);
  });
});

describe("reparseSwfClipInWorker / extractAtlasBitmapInWorker", () => {
  function framesMessage(id: number) {
    const bundle = makeBundle();
    const { atlasPixels: _atlasPixels, ...framesOnly } = bundle;
    const encoded = encodeSwfBundleFrames(framesOnly);
    return {
      id,
      ok: true,
      descriptor: encoded.descriptor,
      floatBuffer: encoded.floatBuffer,
      uintBuffer: encoded.uintBuffer,
    };
  }

  it("keeps the alive atlas and skips atlas payload when reusing it", async () => {
    const atlas = { width: 2, height: 1 } as ImageBitmap;
    const result = client.reparseSwfClipInWorker(
      requestBuffer(),
      "pet",
      undefined,
      atlas,
    );
    const parser = FakeWorker.instances[0]!;
    const request = parser.messages[0]!.data as { mode?: string };
    expect(request.mode).toBe("frames");
    parser.emitMessage(framesMessage(1));

    const clip = await result;
    expect(clip.atlas).toBe(atlas);
    expect(testState.atlasPixelsToBitmap).not.toHaveBeenCalled();
    expect(parser.terminated).toBe(true);
  });

  it("requests full mode and adopts the redecoded atlas when released", async () => {
    const released = { width: 0, height: 0 } as ImageBitmap;
    const result = client.reparseSwfClipInWorker(
      requestBuffer(),
      "pet",
      undefined,
      released,
    );
    const parser = FakeWorker.instances[0]!;
    const request = parser.messages[0]!.data as { mode?: string };
    expect(request.mode).toBe("full");
    const freshAtlas = { width: 2, height: 1 } as ImageBitmap;
    parser.emitMessage(bitmapMessage(1, freshAtlas));

    const clip = await result;
    expect(clip.atlas).toBe(freshAtlas);
  });

  it("extractAtlasBitmapInWorker requests atlas mode and returns the bitmap", async () => {
    const result = client.extractAtlasBitmapInWorker(requestBuffer());
    const parser = FakeWorker.instances[0]!;
    const request = parser.messages[0]!.data as { mode?: string };
    expect(request.mode).toBe("atlas");
    const atlasBitmap = { width: 2, height: 1 } as ImageBitmap;
    parser.emitMessage({ id: 1, ok: true, atlasBitmap });

    await expect(result).resolves.toBe(atlasBitmap);
  });

  it("extractAtlasBitmapInWorker falls back to the transferred RGBA buffer", async () => {
    testState.atlasPixelsToBitmap.mockImplementation(async () => ({
      bitmap: { width: 2, height: 1 } as ImageBitmap,
      width: 2,
      height: 1,
      originalWidth: 2,
      originalHeight: 1,
      scaled: false,
    }));
    const result = client.extractAtlasBitmapInWorker(requestBuffer());
    const parser = FakeWorker.instances[0]!;
    parser.emitMessage(successMessage(1));

    const bitmap = await result;
    expect(bitmap).toMatchObject({ width: 2, height: 1 });
    expect(testState.atlasPixelsToBitmap).toHaveBeenCalled();
  });
});
