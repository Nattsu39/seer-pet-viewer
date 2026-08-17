import "./buffer-setup.js";
import { MaterialResolver } from "./material.js";
import { parseBundleCore } from "./parse.js";
import { encodeParsedSwfBundle } from "./worker-protocol.js";
import type { SwfMaterialState } from "./types.js";

export interface WorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  fileName: string;
  materials?: Record<string, SwfMaterialState>;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, fileName, materials } = event.data;
  try {
    const resolver = new MaterialResolver();
    if (materials) resolver.restore(materials);
    const core = await parseBundleCore(buffer, fileName, resolver);
    const encoded = encodeParsedSwfBundle(core);
    self.postMessage(
      {
        id,
        ok: true,
        descriptor: encoded.descriptor,
        floatBuffer: encoded.floatBuffer,
        uintBuffer: encoded.uintBuffer,
        atlasBuffer: encoded.atlasBuffer,
      },
      [encoded.floatBuffer, encoded.uintBuffer, encoded.atlasBuffer],
    );
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
