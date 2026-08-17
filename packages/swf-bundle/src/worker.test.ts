import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedSwfBundle } from "./types.js";
import type { WorkerRequest } from "./worker.js";

const parseBundleCoreMock = vi.hoisted(() => vi.fn());

vi.mock("./parse.js", () => ({
  parseBundleCore: parseBundleCoreMock,
}));

interface WorkerSelfStub {
  onmessage: ((event: MessageEvent<WorkerRequest>) => unknown) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

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

let workerSelf: WorkerSelfStub;

beforeEach(() => {
  workerSelf = {
    onmessage: null,
    postMessage: vi.fn(),
  };
  vi.stubGlobal("self", workerSelf);
  parseBundleCoreMock.mockReset();
  parseBundleCoreMock.mockResolvedValue(makeBundle());
});

describe("SWF parser worker protocol", () => {
  it("transfers exactly the three response buffers without JSON frame arrays", async () => {
    vi.resetModules();
    await import("./worker.js");
    const handler = workerSelf.onmessage;
    expect(handler).toBeTypeOf("function");

    const input = new ArrayBuffer(16);
    await handler!({
      data: {
        id: 11,
        buffer: input,
        fileName: "pet.bundle",
      },
    } as MessageEvent<WorkerRequest>);

    expect(workerSelf.postMessage).toHaveBeenCalledTimes(1);
    const [response, transfer] = workerSelf.postMessage.mock.calls[0]! as [
      Record<string, unknown>,
      Transferable[],
    ];
    expect(transfer).toEqual([
      response.floatBuffer,
      response.uintBuffer,
      response.atlasBuffer,
    ]);
    expect(transfer).toHaveLength(3);
    expect(transfer).not.toContain(input);
    expect(response.meta).toBeUndefined();
    expect(response.atlasRgba).toBeUndefined();

    const descriptor = response.descriptor as {
      sequences: Array<{
        frames: Array<Record<string, unknown>>;
      }>;
    };
    const frame = descriptor.sequences[0]!.frames[0]!;
    expect(Array.isArray(frame.positions)).toBe(false);
    expect(Array.isArray(frame.uvs)).toBe(false);
    expect(Array.isArray(frame.addColors)).toBe(false);
    expect(Array.isArray(frame.mulColors)).toBe(false);
    expect(Array.isArray(frame.indices)).toBe(false);
    expect(JSON.stringify(response)).not.toContain('"meta"');
  });
});
