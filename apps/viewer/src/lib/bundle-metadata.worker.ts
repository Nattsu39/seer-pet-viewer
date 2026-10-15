import { detectBundleKind } from "@seer-pet-anim/spine-bundle/parse";
import { MaterialResolver } from "@seer-pet-anim/swf-bundle";
import { loadMaterialBundle } from "@seer-pet-anim/swf-bundle/parse";
import type {
  BundleMetadataRequest,
  BundleMetadataResponse,
} from "./bundle-metadata-protocol";

function reply(response: BundleMetadataResponse): void {
  self.postMessage(response);
}

self.onmessage = async (event: MessageEvent<BundleMetadataRequest>) => {
  const request = event.data;
  try {
    if (request.type === "detect") {
      const result = await detectBundleKind(request.buffer);
      reply({ ok: true, type: "detect", result });
    } else {
      const resolver = new MaterialResolver();
      const result = await loadMaterialBundle(request.buffer, resolver);
      reply({
        ok: true,
        type: "materials",
        result: { ...result, materials: resolver.snapshot() },
      });
    }
  } catch (error) {
    reply({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
