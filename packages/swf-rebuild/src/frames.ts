import { resolveMaterial } from "./material.js";
import { ResourceDictionary, type Region } from "./resources.js";
import { place, placeMask, type Matrix, type Tag } from "./swf.js";
import type { Frame, Point } from "./types.js";

export function unpackColor(first: number, second: number): number[] {
  const signed = (value: number): number => ((value & 65535) << 16) >> 16;
  return [
    signed(first >>> 16),
    signed(first),
    signed(second >>> 16),
    signed(second),
  ].map((value) => value / 512);
}

/** 坐标单位为 twip，表示目标 Sprite 内、应用父级放置变换之前的位置。 */
export function quadMatrix(
  vertices: Point[],
  width: number,
  height: number,
  ppu: number,
  origin: [number, number] = [0, 0],
): Matrix {
  if (
    vertices.length !== 4 ||
    vertices.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  ) {
    throw new Error("Expected four finite quad vertices");
  }
  const [v0, v1, v2, v3] = vertices;
  const residual = Math.max(
    Math.abs(v0.x + v2.x - v1.x - v3.x),
    Math.abs(v0.y + v2.y - v1.y - v3.y),
  );
  if (residual > 1e-5) throw new Error(`Non-affine quad: residual ${residual}`);
  return [
    ((v1.x - v0.x) * ppu) / width,
    (-(v1.y - v0.y) * ppu) / width,
    ((v3.x - v0.x) * ppu) / height,
    (-(v3.y - v0.y) * ppu) / height,
    v0.x * ppu * 20 + origin[0],
    -v0.y * ppu * 20 + origin[1],
  ];
}

interface ActiveMask {
  geometry: string;
  depth: number;
  region: Region;
  transform: Matrix;
}

/** 将已验证的平衡单遮罩区间转换为 Flash 原生遮罩。 */
export function framePlacements(
  frame: Frame,
  dictionary: ResourceDictionary,
  ppu: number,
  origin: [number, number],
): { tags: Tag[]; maskCount: number } {
  const quads = frame.vertices.length / 4;
  if (
    !Number.isInteger(quads) ||
    quads > 65534 ||
    [frame.uvs, frame.addColors, frame.mulColors].some(
      (values) => values.length !== quads * 2,
    )
  ) {
    throw new Error("Invalid quad attribute lengths");
  }
  const tags: Tag[] = [];
  let active: ActiveMask | undefined;
  let maskCount = 0;
  let expectedVertex = 0;
  for (const subMesh of frame.subMeshes) {
    const count = subMesh.indexCount / 6;
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      subMesh.startVertex !== expectedVertex ||
      expectedVertex + count * 4 > frame.vertices.length
    )
      throw new Error("Unsupported submesh layout");
    const material = resolveMaterial(subMesh.material);
    for (let q = 0; q < count; q++) {
      const vertex = subMesh.startVertex + q * 4;
      const packed = vertex / 2;
      const pair = [frame.uvs[packed], frame.uvs[packed + 1]] as const;
      const vertices = frame.vertices.slice(vertex, vertex + 4);
      if (material.kind !== "draw") {
        const geometry = JSON.stringify([pair, vertices]);
        if (material.kind === "increment") {
          if (active)
            throw new Error(
              "Nested or overlapping stencil writes are not supported",
            );
          const region = dictionary.mask(...pair);
          const depth = tags.length + 1;
          const transform = quadMatrix(
            vertices,
            region.width,
            region.height,
            ppu,
            origin,
          );
          active = { geometry, depth, region, transform };
          // 闭合写入后才能确定此区间的最终上界。
          tags.push(placeMask(region.id, depth, depth + 1, transform));
          maskCount++;
        } else {
          if (!active || active.geometry !== geometry)
            throw new Error("Unmatched stencil decrement");
          if (tags.length === active.depth) {
            // 平衡的遮罩写入之间可能没有绘制内容。
            // 这种区间不可见，不应裁切后续对象。
            tags.pop();
            maskCount--;
          } else {
            tags[active.depth - 1] = placeMask(
              active.region.id,
              active.depth,
              tags.length,
              active.transform,
            );
          }
          active = undefined;
        }
        continue;
      }
      if (material.stencil !== null && !active)
        throw new Error("Masked draw without an active stencil");
      if (material.stencil === null && active)
        throw new Error("Unmasked draw inside a stencil interval");
      const region = dictionary.region(...pair);
      const add = unpackColor(
        frame.addColors[packed],
        frame.addColors[packed + 1],
      );
      const mul = unpackColor(
        frame.mulColors[packed],
        frame.mulColors[packed + 1],
      );
      if (add[3] !== 0) throw new Error("Additive alpha is not supported");
      tags.push(
        place(
          region.id,
          tags.length + 1,
          quadMatrix(vertices, region.width, region.height, ppu, origin),
          mul,
          add,
          material.blend,
        ),
      );
    }
    expectedVertex += count * 4;
  }
  if (expectedVertex !== frame.vertices.length)
    throw new Error("Unreferenced quad vertices");
  if (active) throw new Error("Unclosed stencil interval");
  return { tags, maskCount };
}
