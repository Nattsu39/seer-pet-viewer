import { Container, Graphics, WebGLRenderer } from "pixi.js";
import { MaterialResolver } from "@seer-pet-anim/swf-bundle";
import {
  loadMaterialBundle,
  parseBundle,
} from "@seer-pet-anim/swf-bundle/parse";
import { SwfPlayer } from "@seer-pet-anim/swf-renderer";

async function fixture(name: string, sha256: string): Promise<ArrayBuffer> {
  const response = await fetch(`/fixtures/${name}`);
  if (!response.ok)
    throw new Error(`Missing real fixture ${name}; set SWF_GRAB_FIXTURES`);
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== sha256) throw new Error(`Unexpected fixture SHA-256: ${name}`);
  return bytes;
}

export async function runRealFixture() {
  const materials = await fixture(
    "shared-materials.bundle",
    "1df8c3bba2fdecf9da717143c4507faa206c23c641df4d9ce7eaa28bb79fcd74",
  );
  const bundle = await fixture(
    "ppets_4911.bundle",
    "847f1d1642945b5b491557e491bb943a5ff333fb80ddfcd0f32254e5592524f5",
  );
  const resolver = new MaterialResolver();
  const materialResult = await loadMaterialBundle(materials, resolver);
  if (materialResult.count !== 19 || materialResult.warnings.length)
    throw new Error("Shared material bundle did not resolve");
  const clip = await parseBundle(bundle, "ppets_4911", resolver);
  if (clip.materialWarnings.length)
    throw new Error(clip.materialWarnings.join("\n"));
  const diagnostics = SwfPlayer.getEmbeddingDiagnostics(clip);
  if (diagnostics.length) throw new Error(diagnostics.join("\n"));
  const renderer = new WebGLRenderer();
  await renderer.init({
    width: 640,
    height: 360,
    antialias: true,
    backgroundAlpha: 0,
  });
  document.body.append(renderer.canvas);
  const stage = new Container();
  const background = stage.addChild(
    new Graphics().rect(0, 0, 640, 360).fill(0x336699),
  );
  const player = new SwfPlayer();
  try {
    await player.mountInto(stage, renderer, clip, { maxTextureSize: 4096 });
    player.setFixedTransform({ x: 320, y: 260 }, { x: 45, y: -45 });
    const sequences = [];
    for (const name of ["attack", "sa", "moves_38419"]) {
      const sequence = clip.sequences.find((item) => item.name === name)!;
      const frames = sequence.frames.flatMap((frame, index) =>
        frame.mesh.subMeshes.some(
          (mesh) =>
            mesh.material.shaderKind === "simpleGrab" ||
            mesh.material.shaderKind === "maskedGrab",
        )
          ? [index]
          : [],
      );
      if (!frames.length)
        throw new Error(
          `${name} has no grab materials; normal fallback is not evidence`,
        );
      player.setSequence(name);
      for (const frame of frames) {
        player.gotoFrame(frame);
        renderer.render(stage);
        if (renderer.gl.getError() !== renderer.gl.NO_ERROR)
          throw new Error(`${name} frame ${frame} WebGL error`);
      }
      sequences.push({ name, grabFrames: frames.length });
    }
    const pixels = new Uint8Array(640 * 360 * 4);
    renderer.gl.readPixels(
      0,
      0,
      640,
      360,
      renderer.gl.RGBA,
      renderer.gl.UNSIGNED_BYTE,
      pixels,
    );
    const reference = new SwfPlayer();
    const normalClip = {
      ...clip,
      sequences: clip.sequences.map((sequence) => ({
        ...sequence,
        frames: sequence.frames.map((frame) => ({
          ...frame,
          mesh: {
            ...frame.mesh,
            subMeshes: frame.mesh.subMeshes.map((mesh) =>
              mesh.material.shaderKind === "simpleGrab"
                ? {
                    ...mesh,
                    material: {
                      ...mesh.material,
                      shaderKind: "simple" as const,
                      blendMode: "normal" as const,
                    },
                  }
                : mesh,
            ),
          },
        })),
      })),
    };
    let changedPixels = 0;
    try {
      player.getContainer().visible = false;
      await reference.mountInto(stage, renderer, normalClip, {
        maxTextureSize: 4096,
      });
      reference.setFixedTransform({ x: 320, y: 260 }, { x: 45, y: -45 });
      reference.setSequence("moves_38419");
      reference.gotoFrame(player.getFrameIndex());
      renderer.render(stage);
      const fallback = new Uint8Array(pixels.length);
      renderer.gl.readPixels(
        0,
        0,
        640,
        360,
        renderer.gl.RGBA,
        renderer.gl.UNSIGNED_BYTE,
        fallback,
      );
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          Math.abs(pixels[i] - fallback[i]) +
            Math.abs(pixels[i + 1] - fallback[i + 1]) +
            Math.abs(pixels[i + 2] - fallback[i + 2]) >
          6
        )
          changedPixels++;
      }
      if (changedPixels < 20)
        throw new Error(
          "Real grab output is indistinguishable from Normal fallback",
        );
    } finally {
      reference.destroy();
      player.getContainer().visible = true;
    }
    background.tint = 0xff0000;
    renderer.render(stage);
    return {
      materials: materialResult.count,
      sequences,
      changedPixelsFromNormal: changedPixels,
      stats: player.getGrabStats(),
    };
  } finally {
    player.destroy();
    stage.destroy({ children: true });
    renderer.destroy();
    clip.atlas.close();
  }
}
