import type {
  AssetFile,
  MonoBehaviour,
  Material as UnityMaterial,
  Sprite,
  Texture2D,
} from "@arkntools/unity-js";
import type { Clip, Material, Point } from "./types.js";

interface Reference {
  m_FileID: number;
  m_PathID: bigint;
}
interface RawFrame {
  Labels: string[];
  Materials: Reference[];
  MeshData: {
    Vertices: Point[];
    UVs: number[];
    AddColors: number[];
    MulColors: number[];
    SubMeshes: { StartVertex: number; IndexCount: number }[];
  };
}
interface RawClip {
  Sprite: Reference;
  FrameRate: number;
  Sequences: { Name: string; Frames: RawFrame[] }[];
}

export async function loadUnityClipWithModule(
  bytes: Uint8Array,
  sharedBytes: Uint8Array,
  { loadAssetBundle, AssetType }: typeof import("@arkntools/unity-js"),
): Promise<Clip> {
  const load = (data: Uint8Array): Promise<AssetFile> =>
    loadAssetBundle(Uint8Array.from(data).buffer);
  const bundle = await load(bytes);
  const shared = await load(sharedBytes);
  const assets = bundle.objects.filter(
    (object) =>
      object.type === AssetType.MonoBehaviour &&
      (object as MonoBehaviour).script.object?.className === "SwfClipAsset",
  );
  if (assets.length !== 1) throw new Error("Expected exactly one SwfClipAsset");
  const tree = assets[0].getTypeTree() as unknown as RawClip;
  const sprites = bundle.objects.filter(
    (object) =>
      object.type === AssetType.Sprite &&
      String(object.pathId) === String(tree.Sprite.m_PathID),
  ) as Sprite[];
  const textures = bundle.objects.filter(
    (object) => object.type === AssetType.Texture2D,
  ) as Texture2D[];
  if (sprites.length !== 1 || textures.length !== 1)
    throw new Error("Only single-atlas clips are supported");
  const materialFor = (reference: Reference): Material => {
    if (reference.m_FileID !== 0 && reference.m_FileID !== 1)
      throw new Error("Unsupported material dependency slot");
    const owner = reference.m_FileID === 0 ? bundle : shared;
    const object = owner.objects.find(
      (entry) =>
        entry.type === AssetType.Material &&
        String(entry.pathId) === String(reference.m_PathID),
    ) as UnityMaterial | undefined;
    if (!object)
      throw new Error(
        `Missing material ${reference.m_FileID}:${reference.m_PathID}`,
      );
    const properties = object.getTypeTree();
    return {
      name: properties.m_Name,
      floats: properties.m_SavedProperties.m_Floats,
    };
  };
  const texture = textures[0];
  // unity-js 没有公开的原始像素读取接口。像现有 swf-bundle 解码器一样，
  // 将依赖特定版本的解码逻辑集中在这里。
  const rgba = (texture as unknown as { image: { data: Uint8Array } }).image
    .data;
  if (
    !(rgba instanceof Uint8Array) ||
    rgba.length !== texture.width * texture.height * 4
  ) {
    throw new Error("Unexpected unity-js raw texture layout");
  }
  return {
    frameRate: tree.FrameRate,
    pixelsPerUnit: sprites[0].pixelsToUnits,
    // 保持解码器的原始行顺序：打包 UV 的 v=0 对应第 0 行。
    atlas: { width: texture.width, height: texture.height, rgba },
    sequences: tree.Sequences.map((sequence) => ({
      name: sequence.Name,
      frames: sequence.Frames.map((frame) => {
        if (frame.Materials.length !== frame.MeshData.SubMeshes.length)
          throw new Error("Material count mismatch");
        return {
          labels: frame.Labels,
          vertices: frame.MeshData.Vertices,
          uvs: frame.MeshData.UVs,
          addColors: frame.MeshData.AddColors,
          mulColors: frame.MeshData.MulColors,
          subMeshes: frame.MeshData.SubMeshes.map((mesh, i) => ({
            startVertex: mesh.StartVertex,
            indexCount: mesh.IndexCount,
            material: materialFor(frame.Materials[i]),
          })),
        };
      }),
    })),
  };
}
