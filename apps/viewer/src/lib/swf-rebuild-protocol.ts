import type { TextureScale } from "@seer-pet-anim/swf-rebuild/browser";

export interface SwfRebuildRequest {
  petId: number;
  bundle: ArrayBuffer;
  materials: ArrayBuffer;
  textureScale: TextureScale;
}

export type SwfRebuildResponse =
  | { type: "progress"; message: string }
  | { type: "complete"; buffer: ArrayBuffer }
  | { type: "error"; message: string };
