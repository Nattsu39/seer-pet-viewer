import type { Material } from "./types.js";

export type MaterialState =
  | { kind: "increment" | "decrement" }
  | { kind: "draw"; blend: number; stencil: number | null };

/** 同时校验材质名称和渲染状态；遇到未知状态时不得静默绘制。 */
export function resolveMaterial(material: Material): MaterialState {
  const { name, floats } = material;
  const fail = (): never => {
    throw new Error(`Unsupported material: ${name}`);
  };
  if (floats._ExternalAlpha !== 0) fail();
  if (name === "SwfIncrMaskShader") return { kind: "increment" };
  if (name === "SwfDecrMaskShader") return { kind: "decrement" };
  const match =
    /^(SwfSimpleShader|SwfSimpleGrabShader|SwfMaskedShader|SwfMaskedGrabShader)_(Normal|Add|Screen|Subtract|Overlay|Hardlight)(?:_(\d+))?$/.exec(
      name,
    );
  if (!match) return fail();
  const masked = match[1].startsWith("SwfMasked");
  const stencil = masked ? Number(match[3]) : null;
  if (
    (masked &&
      (!Number.isInteger(stencil) ||
        stencil !== 1 ||
        floats._StencilID !== stencil)) ||
    (!masked && (match[3] !== undefined || (floats._StencilID ?? 0) !== 0))
  )
    fail();
  const modes: Record<
    string,
    { blend: number; src: number; dst: number; op: number; grab: boolean }
  > = {
    Normal: { blend: 1, src: 1, dst: 10, op: 0, grab: false },
    Add: { blend: 8, src: 1, dst: 1, op: 0, grab: false },
    Screen: { blend: 4, src: 4, dst: 1, op: 0, grab: false },
    Subtract: { blend: 9, src: 1, dst: 1, op: 2, grab: false },
    Overlay: { blend: 13, src: 1, dst: 10, op: 0, grab: true },
    Hardlight: { blend: 14, src: 1, dst: 10, op: 0, grab: true },
  };
  const mode = modes[match[2]];
  if (
    mode.grab !== match[1].includes("Grab") ||
    floats._SrcBlend !== mode.src ||
    floats._DstBlend !== mode.dst ||
    floats._BlendOp !== mode.op
  )
    fail();
  return { kind: "draw", blend: mode.blend, stencil };
}
