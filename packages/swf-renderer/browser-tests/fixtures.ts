import type {
  SwfClipData,
  SwfMaterialState,
  SwfFrameMesh,
} from "@seer-pet-anim/swf-bundle";

export interface Quad {
  rect: [number, number, number, number];
  color?: [number, number, number, number];
}

export interface Layer {
  material: Partial<SwfMaterialState>;
  quads: Quad[];
}

export async function createClip(layers: Layer[]): Promise<SwfClipData> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 8;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(0, 0, 8, 8);
  const positions: number[] = [],
    uvs: number[] = [];
  const mulColors: number[] = [],
    addColors: number[] = [],
    indices: number[] = [];
  const subMeshes: SwfFrameMesh["subMeshes"] = [];
  for (const layer of layers) {
    const startVertex = positions.length / 2;
    const indexStart = indices.length;
    for (const quad of layer.quads) {
      const [x, y, width, height] = quad.rect;
      const base = positions.length / 2;
      positions.push(x, y, x + width, y, x + width, y + height, x, y + height);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let i = 0; i < 4; i++) {
        mulColors.push(...(quad.color ?? [1, 1, 1, 1]));
        addColors.push(0, 0, 0, 0);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    subMeshes.push({
      startVertex,
      indexStart,
      indexCount: indices.length - indexStart,
      material: {
        shaderKind: "simple",
        blendMode: "normal",
        srcBlend: 1,
        dstBlend: 10,
        blendOp: 0,
        stencilId: 0,
        ...layer.material,
      },
    });
  }
  return {
    petId: 0,
    name: "synthetic grab",
    frameRate: 24,
    atlasWidth: 8,
    atlasHeight: 8,
    atlas: await createImageBitmap(canvas),
    materialWarnings: [],
    sequences: [
      {
        name: "standby",
        frames: [
          {
            labels: [],
            mesh: {
              positions: new Float32Array(positions),
              uvs: new Float32Array(uvs),
              mulColors: new Float32Array(mulColors),
              addColors: new Float32Array(addColors),
              indices: new Uint16Array(indices),
              subMeshes,
            },
          },
        ],
      },
    ],
  };
}
