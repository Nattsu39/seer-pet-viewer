import { resolveMaterial } from "./material.js";
import { ResourceDictionary, type Region } from "./resources.js";
import {
  place,
  placeMask,
  placeSprite,
  type Matrix,
  type Tag,
} from "./swf.js";
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

interface MaskScope {
  geometry: string;
  baseDepth: number;
  region: Region;
  transform: Matrix;
  tags: Tag[];
}

/** 将已验证的平衡遮罩区间（含嵌套与重叠交集）转换为 Flash 原生遮罩。 */
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
  const rootTags: Tag[] = [];
  const stack: MaskScope[] = [];
  let maskCount = 0;
  let expectedVertex = 0;

  const pushToCurrent = (tagForDepth: (depth: number) => Tag): void => {
    const parent = stack[stack.length - 1];
    const target = parent ? parent.tags : rootTags;
    const depth = parent
      ? parent.baseDepth + 1 + parent.tags.length
      : rootTags.length + 1;
    if (depth > 65535) throw new Error("SWF display list depth exhausted");
    target.push(tagForDepth(depth));
  };

  const openScope = (
    geometry: string,
    region: Region,
    transform: Matrix,
  ): void => {
    if (stack.length >= 255)
      throw new Error("Stencil nesting depth exceeds 255");
    const baseDepth = stack.length === 0 ? rootTags.length + 1 : 1;
    if (baseDepth > 65534) throw new Error("SWF display list depth exhausted");
    stack.push({ geometry, baseDepth, region, transform, tags: [] });
  };

  const closeTopScope = (): void => {
    const scope = stack.pop()!;
    // 平衡的遮罩写入之间可能没有绘制内容。
    // 这种区间不可见，不应裁切后续对象。
    if (scope.tags.length === 0) return;
    if (stack.length === 0) {
      rootTags.push(
        placeMask(
          scope.region.id,
          scope.baseDepth,
          scope.baseDepth + scope.tags.length,
          scope.transform,
        ),
        ...scope.tags,
      );
    } else {
      // Flash 同层时间轴不支持嵌套 ClipDepth，内层遮罩封装为单帧 DefineSprite。
      const spriteId = dictionary.defineSprite([
        [
          placeMask(
            scope.region.id,
            1,
            1 + scope.tags.length,
            scope.transform,
          ),
          ...scope.tags,
        ],
      ]);
      pushToCurrent((depth) => placeSprite(spriteId, depth));
    }
    maskCount++;
  };

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
          const region = dictionary.mask(...pair);
          const transform = quadMatrix(
            vertices,
            region.width,
            region.height,
            ppu,
            origin,
          );
          openScope(geometry, region, transform);
        } else {
          let matchIndex = -1;
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].geometry === geometry) {
              matchIndex = i;
              break;
            }
          }
          if (matchIndex < 0) throw new Error("Unmatched stencil decrement");
          const reopen: Pick<MaskScope, "geometry" | "region" | "transform">[] =
            [];
          while (stack.length - 1 > matchIndex) {
            const top = stack[stack.length - 1];
            reopen.push({
              geometry: top.geometry,
              region: top.region,
              transform: top.transform,
            });
            closeTopScope();
          }
          closeTopScope();
          for (let i = reopen.length - 1; i >= 0; i--) {
            const entry = reopen[i];
            openScope(entry.geometry, entry.region, entry.transform);
          }
        }
        continue;
      }
      if (material.stencil !== null && stack.length === 0)
        throw new Error("Masked draw without an active stencil");
      if (material.stencil === null && stack.length > 0)
        throw new Error("Unmasked draw inside a stencil interval");
      if (material.stencil !== null && material.stencil !== stack.length)
        throw new Error(
          `Stencil reference ${material.stencil} does not match active stencil depth ${stack.length}`,
        );
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
      const transform = quadMatrix(
        vertices,
        region.width,
        region.height,
        ppu,
        origin,
      );
      pushToCurrent((depth) =>
        place(region.id, depth, transform, mul, add, material.blend),
      );
    }
    expectedVertex += count * 4;
  }
  if (expectedVertex !== frame.vertices.length)
    throw new Error("Unreferenced quad vertices");
  if (stack.length > 0) throw new Error("Unclosed stencil interval");
  return { tags: rootTags, maskCount };
}
