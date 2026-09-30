import { VERSION, WebGLRenderer, type Container, type Renderer } from "pixi.js";
import type { SwfClipData } from "@seer-pet-anim/swf-bundle";
import { isAtlasTileWarning } from "@seer-pet-anim/swf-bundle";
import { needsGrabPass, needsStencilTest } from "./blend.js";

/** Version qualified by the render-time framebuffer and pixel tests. */
export const SWF_GRAB_REQUIREMENTS = Object.freeze({
  pixiVersion: "8.19.0",
  renderer: "webgl",
  webGLVersion: 2,
  backBuffer: "required-for-opaque-canvas",
  hostMasks: "stencil",
} as const);

export interface SwfEmbeddingContext {
  renderer?: Renderer;
  parent?: Container;
}

const grabModes = new Set([
  "darken",
  "difference",
  "invert",
  "overlay",
  "hardlight",
]);
const simpleModes = new Set([
  "normal",
  "layer",
  "multiply",
  "screen",
  "lighten",
  "add",
  "subtract",
]);
const shaderKinds = new Set([
  "simple",
  "simpleGrab",
  "masked",
  "maskedGrab",
  "incrMask",
  "decrMask",
]);

export function hasGrabMaterials(clip: SwfClipData): boolean {
  return clip.sequences.some((sequence) =>
    sequence.frames.some((frame) =>
      frame.mesh.subMeshes.some((mesh) => needsGrabPass(mesh.material)),
    ),
  );
}

/** Isolation effects remove the battle backdrop before our instruction runs. */
export function getGrabHostDiagnostics(parent?: Container): string[] {
  for (let node = parent; node; node = node.parent ?? undefined) {
    if (node.effects?.some((effect) => effect.pipe === "alphaMask")) {
      return [
        "SWF grab does not support host alpha masks; use a Graphics/Container stencil mask",
      ];
    }
    if (node.effects?.some((effect) => effect.pipe === "scissorMask")) {
      return [
        "SWF grab supports stencil host masks; scissor masks are not qualified",
      ];
    }
    if (
      node.effects?.some((effect) => effect.pipe === "filter") ||
      node.isCachedAsTexture
    ) {
      return [
        "SWF grab does not support host filters or cacheAsTexture; render the shared battlefield directly",
      ];
    }
    if (node.blendMode !== "normal" && node.blendMode !== "inherit") {
      return ["SWF grab requires normal host container blending"];
    }
  }
  return [];
}

export function getEmbeddingDiagnostics(
  clip: SwfClipData,
  context: SwfEmbeddingContext = {},
): string[] {
  const diagnostics = new Set(
    (clip.materialWarnings ?? []).filter(
      (warning) => !isAtlasTileWarning(warning),
    ),
  );
  for (const sequence of clip.sequences) {
    for (const frame of sequence.frames) {
      let masked = false;
      for (const { material } of frame.mesh.subMeshes) {
        if (!shaderKinds.has(material.shaderKind))
          diagnostics.add(
            `Unsupported SWF shader kind: ${material.shaderKind}`,
          );
        if (needsGrabPass(material)) {
          if (!grabModes.has(material.grabBlend ?? ""))
            diagnostics.add(
              `Unsupported SWF grab blend: ${material.grabBlend}`,
            );
          if (
            material.srcBlend !== 1 ||
            material.dstBlend !== 10 ||
            material.blendOp !== 0
          ) {
            diagnostics.add(
              "SWF grab requires source-over material blend state (1, 10, 0)",
            );
          }
        } else if (!simpleModes.has(material.blendMode)) {
          diagnostics.add(
            `Unsupported SWF blend/shader combination: ${material.blendMode}/${material.shaderKind}`,
          );
        }
        if (material.shaderKind === "incrMask") {
          if (masked) diagnostics.add("Nested SWF mask groups are unsupported");
          masked = true;
        } else if (material.shaderKind === "decrMask") {
          if (!masked) diagnostics.add("Unmatched SWF mask clearer");
          masked = false;
        } else if (needsStencilTest(material)) {
          if (!masked)
            diagnostics.add(
              "SWF masked content requires a preceding mask writer",
            );
          // Older bundle parsers emitted 0 for the implicit first mask level.
          if (material.stencilId !== 0 && material.stencilId !== 1)
            diagnostics.add(
              `Unsupported SWF stencil reference: ${material.stencilId}`,
            );
        } else if (masked) {
          diagnostics.add(
            "SWF mask content must be contiguous and end with a mask clearer",
          );
        }
      }
      if (masked) diagnostics.add("Unclosed SWF mask group");
    }
  }
  if (context.renderer && !(context.renderer instanceof WebGLRenderer)) {
    diagnostics.add(
      "A compatible Pixi WebGLRenderer is required (one shared Pixi installation)",
    );
  }
  if (hasGrabMaterials(clip)) {
    if (String(VERSION) !== SWF_GRAB_REQUIREMENTS.pixiVersion)
      diagnostics.add(
        `SWF grab requires Pixi ${SWF_GRAB_REQUIREMENTS.pixiVersion}; received ${VERSION}`,
      );
    if (
      context.renderer instanceof WebGLRenderer &&
      context.renderer.context?.webGLVersion !== 2
    ) {
      diagnostics.add("SWF grab requires an initialized WebGL2 renderer");
    }
    if (
      context.renderer instanceof WebGLRenderer &&
      context.renderer.gl?.getContextAttributes()?.alpha === false &&
      !context.renderer.backBuffer.useBackBuffer
    ) {
      diagnostics.add(
        "SWF grab on an opaque canvas requires renderer.init({ useBackBuffer: true })",
      );
    }
    for (const diagnostic of getGrabHostDiagnostics(context.parent))
      diagnostics.add(diagnostic);
  }
  return [...diagnostics];
}
