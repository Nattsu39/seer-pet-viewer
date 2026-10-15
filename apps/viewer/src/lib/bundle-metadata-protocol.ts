import type { BundleKind } from "@seer-pet-anim/spine-bundle";
import type { SwfMaterialState } from "@seer-pet-anim/swf-bundle";

export type BundleMetadataRequest =
  | { type: "detect"; buffer: ArrayBuffer }
  | { type: "materials"; buffer: ArrayBuffer };

export interface BundleMetadataResults {
  detect: BundleKind;
  materials: {
    count: number;
    warnings: string[];
    materials: Record<string, SwfMaterialState>;
  };
}

export type BundleMetadataResponse =
  | { ok: true; type: "detect"; result: BundleMetadataResults["detect"] }
  | { ok: true; type: "materials"; result: BundleMetadataResults["materials"] }
  | { ok: false; error: string };
