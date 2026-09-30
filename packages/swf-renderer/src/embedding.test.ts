import { expect, it } from "vitest";
import type { SwfClipData, SwfMaterialState } from "@seer-pet-anim/swf-bundle";
import { Container, Sprite, Texture, WebGLRenderer } from "pixi.js";
import { SwfPlayer } from "./player.js";

function clip(material: Partial<SwfMaterialState>): SwfClipData {
  return {
    materialWarnings: [],
    sequences: [
      {
        name: "attack",
        frames: [
          {
            mesh: {
              subMeshes: [
                {
                  material: {
                    shaderKind: "simpleGrab",
                    blendMode: "invert",
                    grabBlend: "invert",
                    srcBlend: 1,
                    dstBlend: 10,
                    blendOp: 0,
                    stencilId: 0,
                    ...material,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  } as SwfClipData;
}

it("accepts supported grab materials in a clip-only preload query", () => {
  expect(SwfPlayer.getEmbeddingDiagnostics(clip({}))).toEqual([]);
});

it("reports an uninitialized renderer without throwing", () => {
  const renderer = new WebGLRenderer();
  expect(
    SwfPlayer.getEmbeddingDiagnostics(clip({}), { renderer }).join(" "),
  ).toMatch(/initialized WebGL2/);
});

it("rejects unknown grab operations instead of silently rendering normal", () => {
  expect(
    SwfPlayer.getEmbeddingDiagnostics(clip({ grabBlend: "add" })).join(" "),
  ).toMatch(/grab/i);
});

it("rejects unknown shader kinds", () => {
  expect(
    SwfPlayer.getEmbeddingDiagnostics(
      clip({ shaderKind: "future" as never }),
    ).join(" "),
  ).toMatch(/shader/i);
});

it("rejects unresolved shared materials", () => {
  const data = clip({});
  data.materialWarnings = ["External material unavailable"];
  expect(SwfPlayer.getEmbeddingDiagnostics(data).join(" ")).toContain(
    "External material unavailable",
  );
});

it("rejects a grab under an alpha mask before mounting", () => {
  const parent = new Container();
  parent.mask = new Sprite(Texture.WHITE);
  expect(
    SwfPlayer.getEmbeddingDiagnostics(clip({}), { parent }).join(" "),
  ).toMatch(/alpha.*mask/i);
  parent.destroy();
});

it("rejects unsupported SWF stencil references and malformed mask groups", () => {
  expect(
    SwfPlayer.getEmbeddingDiagnostics(
      clip({ shaderKind: "maskedGrab", stencilId: 9 }),
    ).join(" "),
  ).toMatch(/mask|stencil/i);
});
