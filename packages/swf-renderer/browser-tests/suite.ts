import {
  Container,
  Graphics,
  Matrix,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  WebGLRenderer,
} from "pixi.js";
import type { SwfBlendMode } from "@seer-pet-anim/swf-bundle";
import { SwfPlayer } from "@seer-pet-anim/swf-renderer";
import { createClip, type Layer } from "./fixtures";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pixel(renderer: WebGLRenderer, expected: number[], x = 16, y = 16) {
  const actual = new Uint8Array(4);
  const gl = renderer.gl;
  const target = renderer.renderTarget.renderTarget;
  const resolution = target.resolution;
  gl.readPixels(
    x * resolution,
    target.isRoot ? target.pixelHeight - y * resolution - 1 : y * resolution,
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    actual,
  );
  assert(
    actual.every((value, i) => Math.abs(value - expected[i]) <= 2),
    `pixel (${x}, ${y}): ${actual}; expected ${expected}`,
  );
  assert(gl.getError() === gl.NO_ERROR, "WebGL error after drawing");
}

function grab(mode: SwfBlendMode, alpha = 0.5): Layer {
  return {
    material: { shaderKind: "simpleGrab", blendMode: mode, grabBlend: mode },
    quads: [{ rect: [4, 4, 24, 24], color: [0.8, 0.25, 0.5, alpha] }],
  };
}

async function scene(
  layers: Layer[],
  run: (context: {
    renderer: WebGLRenderer;
    stage: Container;
    background: Graphics;
    player: SwfPlayer;
  }) => void | Promise<void>,
  options: {
    maxTextureSize?: number;
    antialias?: boolean;
    resolution?: number;
    useBackBuffer?: boolean;
    backgroundAlpha?: number;
  } = {},
) {
  const renderer = new WebGLRenderer();
  await renderer.init({
    width: 32,
    height: 32,
    antialias: options.antialias ?? false,
    resolution: options.resolution ?? 1,
    useBackBuffer: options.useBackBuffer ?? false,
    backgroundAlpha: options.backgroundAlpha ?? 0,
  });
  document.body.append(renderer.canvas);
  const stage = new Container();
  const background = stage.addChild(
    new Graphics().rect(0, 0, 32, 32).fill(0x336699),
  );
  const clip = await createClip(layers);
  const player = new SwfPlayer();
  try {
    await player.mountInto(stage, renderer, clip, {
      maxTextureSize: options.maxTextureSize,
    });
    player.setSequence("standby");
    await run({ renderer, stage, background, player });
  } finally {
    player.destroy();
    clip.atlas.close();
    stage.destroy({ children: true });
    renderer.destroy({ removeView: true });
  }
}

const cases: Array<[string, () => Promise<void>]> = [];
function test(name: string, run: () => Promise<void>) {
  cases.push([name, run]);
}

// Worked Unity grab_blend examples: background (0.2, 0.4, 0.6),
// source (0.8, 0.25, 0.5), coverage 0.5, followed by source-over.
const blends: Array<[SwfBlendMode, number[]]> = [
  ["darken", [51, 83, 140, 255]],
  ["difference", [102, 70, 89, 255]],
  ["invert", [128, 128, 128, 255]],
  ["overlay", [66, 77, 153, 255]],
  ["hardlight", [112, 77, 153, 255]],
];
for (const [mode, expected] of blends) {
  for (const masked of [false, true]) {
    test(`${masked ? "masked" : "simple"} ${mode}`, async () => {
      const content = grab(mode);
      content.material.shaderKind = masked ? "maskedGrab" : "simpleGrab";
      const layers: Layer[] = masked
        ? [
            {
              material: { shaderKind: "incrMask" },
              quads: [{ rect: [8, 8, 16, 16] }],
            },
            content,
            {
              material: { shaderKind: "decrMask" },
              quads: [{ rect: [8, 8, 16, 16] }],
            },
          ]
        : [content];
      await scene(layers, ({ renderer, stage }) => {
        renderer.render(stage);
        pixel(renderer, expected);
        pixel(renderer, [51, 102, 153, 255], 2, 2);
        if (masked) pixel(renderer, [51, 102, 153, 255], 6, 6);
      });
    });
  }
}

test("host opacity applies once to grab coverage", () =>
  scene([grab("invert")], ({ renderer, stage, player }) => {
    player.getContainer().alpha = 0.5;
    renderer.render(stage);
    pixel(renderer, [89, 115, 140, 255]);
  }));

test("host back buffer remains compatible", () =>
  scene(
    [grab("darken")],
    ({ renderer, stage }) => {
      renderer.render(stage);
      pixel(renderer, [51, 83, 140, 255]);
    },
    { antialias: true, useBackBuffer: true },
  ));

test("standalone manual drawing and frame capture share grab semantics", async () => {
  const host = document.createElement("div");
  host.style.cssText = "width:32px;height:32px";
  document.body.append(host);
  const clip = await createClip([grab("invert")]);
  const player = new SwfPlayer();
  try {
    await player.mount(host, clip, {
      clock: "manual",
      mode: "fixed",
      backgroundColor: 0x336699,
    });
    player.setSequence("standby");
    player.setFixedTransform({ x: 0, y: 0 }, { x: 1, y: 1 });
    assert(
      player.getGrabStats().captures === 0,
      "manual initialization captured a background",
    );
    player.draw();
    const gl = player.getCanvas().getContext("webgl2")!;
    const actual = new Uint8Array(4);
    gl.readPixels(16, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
    assert(
      actual.slice(0, 3).every((value) => Math.abs(value - 128) <= 2),
      `standalone grab: ${actual}; GL error: ${gl.getError()}`,
    );
    let frames = 0;
    for await (const frame of player.captureFrames({
      sequence: "standby",
      scale: 0.01,
      background: "transparent",
    })) {
      const index =
        (Math.floor(frame.height / 2) * frame.width +
          Math.floor(frame.width / 2)) *
        4;
      // Captured frames use straight alpha for PNG/WebP encoding.
      const center = frame.pixels.slice(index, index + 4);
      assert(
        center.slice(0, 3).every((value) => Math.abs(value - 255) <= 2) &&
          Math.abs(center[3]! - 128) <= 2,
        `captured grab: ${center}`,
      );
      frames++;
    }
    assert(frames === 1, "capture did not yield the selected frame");
    player.draw();
    assert(
      gl.getError() === gl.NO_ERROR,
      "standalone WebGL error after capture",
    );
  } finally {
    player.destroy();
    clip.atlas.close();
    host.remove();
  }
});

for (const alpha of [0.25, 0.5, 0.75, 1]) {
  test(`transparent capture preserves PNG colors at alpha ${alpha}`, async () => {
    const host = document.createElement("div");
    host.style.cssText = "width:32px;height:32px";
    document.body.append(host);
    const clip = await createClip([
      {
        material: {},
        quads: [{ rect: [0, 0, 32, 32], color: [0.8, 0.4, 0.2, alpha] }],
      },
    ]);
    const player = new SwfPlayer();
    try {
      await player.mount(host, clip, { clock: "manual" });
      player.setSequence("standby");
      let frames = 0;
      for await (const frame of player.captureFrames({
        sequence: "standby",
        scale: 0.01,
        background: "transparent",
      })) {
        const x = Math.floor(frame.width / 2);
        const y = Math.floor(frame.height / 2);
        const offset = (y * frame.width + x) * 4;
        const center = frame.pixels.slice(offset, offset + 4);
        const expected = [204, 102, 51, Math.round(alpha * 255)];
        assert(
          center.every((value, i) => Math.abs(value - expected[i]!) <= 2),
          `straight-alpha capture: ${center}; expected ${expected}`,
        );

        const canvas = new OffscreenCanvas(frame.width, frame.height);
        const context = canvas.getContext("2d")!;
        context.putImageData(
          new ImageData(
            new Uint8ClampedArray(frame.pixels),
            frame.width,
            frame.height,
          ),
          0,
          0,
        );
        const bitmap = await createImageBitmap(
          await canvas.convertToBlob({ type: "image/png" }),
        );
        try {
          context.fillStyle = "black";
          context.fillRect(0, 0, frame.width, frame.height);
          context.drawImage(bitmap, 0, 0);
          const composite = context.getImageData(x, y, 1, 1).data;
          const expectedComposite = [204, 102, 51].map((value) =>
            Math.round(value * alpha),
          );
          expectedComposite.push(255);
          assert(
            composite.every(
              (value, i) => Math.abs(value - expectedComposite[i]!) <= 2,
            ),
            `PNG on black: ${composite}; expected ${expectedComposite}`,
          );
        } finally {
          bitmap.close();
        }
        frames++;
      }
      assert(frames === 1, "capture did not yield the selected frame");
    } finally {
      player.destroy();
      clip.atlas.close();
      host.remove();
    }
  });
}

test("paused grab reads changed background and excludes later HUD", () =>
  scene([grab("invert", 1)], ({ renderer, stage, background, player }) => {
    const hud = stage.addChild(
      new Graphics().rect(12, 12, 8, 8).fill(0x00ff00),
    );

    player.pause();
    renderer.render(stage);
    pixel(renderer, [204, 153, 102, 255], 8, 8);
    pixel(renderer, [0, 255, 0, 255]);
    background.tint = 0xff0000;
    hud.visible = false;
    renderer.render(stage);
    pixel(renderer, [204, 255, 255, 255]);
  }));

test("sequential grabs include intervening normal layer", () =>
  scene(
    [
      grab("invert", 1),
      {
        material: {},
        quads: [{ rect: [4, 4, 24, 24], color: [0, 0.25, 1, 0.5] }],
      },
      grab("invert", 1),
    ],
    ({ renderer, stage }) => {
      renderer.render(stage);
      pixel(renderer, [153, 147, 77, 255]);
    },
  ));

for (const tiled of [false, true]) {
  test(`overlapping quads share one submesh snapshot${tiled ? " across atlas tiles" : ""}`, () => {
    const layer = grab("invert");
    layer.quads.push({ rect: [10, 10, 16, 16], color: [1, 1, 1, 0.5] });
    return scene(
      [layer],
      ({ renderer, stage }) => {
        renderer.render(stage);
        pixel(renderer, [166, 140, 115, 255]);
        pixel(renderer, [128, 128, 128, 255], 8, 8);
      },
      { maxTextureSize: tiled ? 5 : undefined },
    );
  });
}

test("transparent target keeps PMA edges", () =>
  scene([grab("invert")], ({ renderer, stage, background }) => {
    background.visible = false;
    renderer.render(stage);
    pixel(renderer, [128, 128, 128, 128]);
    pixel(renderer, [0, 0, 0, 0], 2, 2);
  }));

const transparentBlends: Array<[SwfBlendMode, number[]]> = [
  ["darken", [26, 51, 77, 191]],
  ["difference", [102, 32, 64, 191]],
  ["invert", [128, 128, 128, 191]],
  ["overlay", [33, 38, 77, 191]],
  ["hardlight", [94, 38, 77, 191]],
];
for (const [mode, expected] of transparentBlends) {
  test(`${mode} uses stored framebuffer RGB on a translucent background`, () =>
    scene([grab(mode)], ({ renderer, stage, background }) => {
      background.alpha = 0.5;
      renderer.render(stage);
      pixel(renderer, expected);
    }));
}

test("internal mask intersects host stencil without clipping HUD", () =>
  scene(
    [
      {
        material: { shaderKind: "incrMask" },
        quads: [{ rect: [8, 4, 16, 24] }],
      },
      {
        ...grab("invert", 1),
        material: { shaderKind: "maskedGrab", grabBlend: "invert" },
      },
      {
        material: { shaderKind: "decrMask" },
        quads: [{ rect: [8, 4, 16, 24] }],
      },
    ],
    ({ renderer, stage, player }) => {
      const outer = stage.addChild(new Container());
      outer.addChild(player.getContainer());
      const mask = outer.addChild(
        new Graphics().rect(4, 8, 24, 16).fill(0xffffff),
      );
      outer.mask = mask;
      stage.addChild(new Graphics().rect(0, 0, 3, 3).fill(0x00ff00));
      renderer.render(stage);
      pixel(renderer, [204, 153, 102, 255]);
      pixel(renderer, [51, 102, 153, 255], 6, 16);
      pixel(renderer, [51, 102, 153, 255], 16, 6);
      pixel(renderer, [0, 255, 0, 255], 1, 1);
    },
  ));

for (const resolution of [1, 2]) {
  test(`mirror, resize and viewport sampling at DPR ${resolution}`, () =>
    scene(
      [grab("invert", 1)],
      ({ renderer, stage, background, player }) => {
        background
          .clear()
          .rect(0, 0, 64, 16)
          .fill(0xff0000)
          .rect(0, 16, 64, 48)
          .fill(0x0000ff);
        player.getContainer().scale.set(-1, 1);
        player.getContainer().x = 32;
        renderer.render(stage);
        pixel(renderer, [0, 255, 255, 255], 16, 8);
        pixel(renderer, [255, 255, 0, 255], 16, 24);
        renderer.resize(64, 64);
        renderer.render(stage);
        pixel(renderer, [0, 255, 255, 255], 16, 8);
        pixel(renderer, [255, 255, 0, 255], 16, 24);
        const target = RenderTexture.create({
          width: 64,
          height: 64,
          resolution,
          antialias: true,
        });
        const view = new Texture({
          source: target.source,
          frame: new Rectangle(8, 12, 32, 32),
        });
        try {
          renderer.render({
            container: stage,
            target: view,
            transform: new Matrix(),
          });
          // RenderTexture pixel rows run in the opposite direction to a canvas.
          renderer.renderTarget.finishRenderPass();
          renderer.gl.bindFramebuffer(
            renderer.gl.FRAMEBUFFER,
            renderer.renderTarget.getGpuRenderTarget(
              renderer.renderTarget.renderTarget,
            ).resolveTargetFramebuffer,
          );
          pixel(renderer, [0, 255, 255, 255], 24, 20);
          pixel(renderer, [255, 255, 0, 255], 24, 36);
        } finally {
          view.destroy();
          target.destroy(true);
        }
      },
      { resolution, antialias: true },
    ));
}

test("two players follow host order and own only their resources", () =>
  scene([grab("invert", 1)], async ({ renderer, stage, player }) => {
    const secondClip = await createClip([grab("darken", 1)]);
    const other = new SwfPlayer();
    try {
      await other.mountInto(stage, renderer, secondClip);
      other.setSequence("standby");
      assert(
        player.getGrabStats().captures === 0 &&
          other.getGrabStats().captures === 0,
        "preload drew the host",
      );
      player.pause();
      other.pause();
      renderer.render(stage);
      pixel(renderer, [204, 64, 102, 255]);
      stage.swapChildren(player.getContainer(), other.getContainer());
      renderer.render(stage);
      pixel(renderer, [204, 191, 128, 255]);
      const stats = player.getGrabStats();
      assert(
        stats.captures === 2 &&
          stats.copiedPixels === 2048 &&
          stats.scratchBytes === 4096,
        "incorrect capture accounting",
      );
      player.destroy();
      player.destroy();
      assert(
        player.getGrabStats().scratchBytes === 0,
        "scratch survived player destruction",
      );
      renderer.render(stage);
      pixel(renderer, [51, 64, 128, 255]);
      assert(secondClip.atlas.width === 8, "borrowed atlas was destroyed");
    } finally {
      other.destroy();
      secondClip.atlas.close();
    }
  }));

test("cancelled tiled mount leaves the host usable", () =>
  scene([grab("invert", 1)], async ({ renderer, stage }) => {
    const clip = await createClip([grab("darken")]);
    const controller = new AbortController();
    const cancelled = new SwfPlayer();
    const pending = cancelled.mountInto(stage, renderer, clip, {
      signal: controller.signal,
      maxTextureSize: 5,
    });
    controller.abort();
    try {
      await pending;
      throw new Error("mount should reject");
    } catch (error) {
      assert(
        error instanceof DOMException && error.name === "AbortError",
        "unexpected cancellation result",
      );
    }
    cancelled.destroy();
    // Cropping can finish after cancellation; allow that cleanup to complete.
    await new Promise((resolve) => setTimeout(resolve, 30));
    renderer.render(stage);
    pixel(renderer, [204, 153, 102, 255]);
    assert(clip.atlas.width === 8, "cancelled mount closed the borrowed atlas");
    clip.atlas.close();
  }));

test("late host alpha masks fail before drawing and can be removed", () =>
  scene([grab("invert", 1)], ({ renderer, stage, player }) => {
    const mask = stage.addChild(new Sprite(Texture.WHITE));
    player.getContainer().mask = mask;
    let message = "";
    try {
      renderer.render(stage);
    } catch (error) {
      message = String(error);
    }
    assert(
      /alpha.*mask/i.test(message),
      "late unsupported mask was silently accepted",
    );
    player.getContainer().mask = null;
    mask.destroy();
    renderer.render(stage);
    pixel(renderer, [204, 153, 102, 255]);
  }));

test("WebGL1 is rejected before attaching a player", async () => {
  const renderer = new WebGLRenderer();
  await renderer.init({ width: 32, height: 32, preferWebGLVersion: 1 });
  const parent = new Container();
  const clip = await createClip([grab("invert")]);
  const player = new SwfPlayer();
  try {
    let message = "";
    try {
      await player.mountInto(parent, renderer, clip);
    } catch (error) {
      message = String(error);
    }
    assert(
      message.includes("WebGL2"),
      "WebGL1 should fail capability diagnosis",
    );
    assert(parent.children.length === 0, "failed mount attached resources");
    renderer.render(parent);
  } finally {
    player.destroy();
    clip.atlas.close();
    parent.destroy();
    renderer.destroy();
  }
});

test("context restoration rebuilds grab and atlas without remounting", () =>
  scene([grab("invert", 1)], async ({ renderer, stage, background }) => {
    renderer.render(stage);
    pixel(renderer, [204, 153, 102, 255]);
    const extension = renderer.gl.getExtension("WEBGL_lose_context");
    assert(extension, "WEBGL_lose_context unavailable");
    const event = (name: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${name} timeout`)),
          10000,
        );
        renderer.canvas.addEventListener(
          name,
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    const lost = event("webglcontextlost");
    extension.loseContext();
    await lost;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const restored = event("webglcontextrestored");
    extension.restoreContext();
    await restored;
    background.tint = 0xff0000;
    renderer.render(stage);
    pixel(renderer, [204, 255, 255, 255]);
  }));

const performanceResults: Array<Record<string, number>> = [];

test("opaque host with a back buffer composites correctly", () =>
  scene(
    [grab("darken")],
    ({ renderer, stage }) => {
      renderer.render(stage);
      pixel(renderer, [51, 83, 140, 255]);
    },
    { backgroundAlpha: 1, useBackBuffer: true, antialias: true },
  ));

test("opaque host without a back buffer fails before allocating player resources", async () => {
  const renderer = new WebGLRenderer();
  await renderer.init({ width: 32, height: 32, backgroundAlpha: 1 });
  const stage = new Container();
  stage.addChild(new Graphics().rect(0, 0, 32, 32).fill(0x336699));
  const clip = await createClip([grab("invert")]);
  const player = new SwfPlayer();
  try {
    let message = "";
    try {
      await player.mountInto(stage, renderer, clip);
    } catch (error) {
      message = String(error);
    }
    assert(
      message.includes("useBackBuffer"),
      "opaque host should require a back buffer",
    );
    assert(
      player.getGrabStats().scratchBytes === 0 && stage.children.length === 1,
      "failed mount allocated resources",
    );
    renderer.render(stage);
    pixel(renderer, [51, 102, 153, 255]);
  } finally {
    player.destroy();
    clip.atlas.close();
    stage.destroy({ children: true });
    renderer.destroy();
  }
});
for (const resolution of [1, 2]) {
  test(`two-player 1080p capture budget at DPR ${resolution}`, () =>
    scene([grab("invert", 1)], async ({ renderer, stage, player }) => {
      renderer.resize(1920, 1080, resolution);
      const clip = await createClip([grab("darken", 1)]);
      const other = new SwfPlayer();
      try {
        await other.mountInto(stage, renderer, clip);
        other.setSequence("standby");
        for (let i = 0; i < 5; i++) renderer.render(stage);
        renderer.gl.finish();
        const before = player.getGrabStats();
        const start = performance.now();
        for (let i = 0; i < 30; i++) renderer.render(stage);
        renderer.gl.finish();
        pixel(renderer, [204, 64, 102, 255]);
        const frameMs = (performance.now() - start) / 30;
        const after = player.getGrabStats();
        const area = 1920 * 1080 * resolution ** 2;
        assert(
          after.captures - before.captures === 30,
          "expected one copy per player per host draw",
        );
        assert(
          after.copiedPixels - before.copiedPixels === 30 * area,
          "incorrect copy volume",
        );
        assert(after.scratchBytes === area * 4, "incorrect scratch budget");
        performanceResults.push({
          resolution,
          frameMs,
          capturesPerFrame: 2,
          copiedPixelsPerFrame: area * 2,
          scratchBytes: area * 8,
        });
      } finally {
        other.destroy();
        clip.atlas.close();
      }
    }));
}

async function run() {
  const passed: string[] = [],
    failures: string[] = [];
  for (const [name, runCase] of cases) {
    try {
      await runCase();
      passed.push(name);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.stack : error}`);
    }
  }
  assert(failures.length === 0, failures.join("\n"));
  return {
    passed: passed.length,
    cases: passed,
    performance: performanceResults,
  };
}

Object.assign(window, {
  swfGrabTests: location.search.includes("real")
    ? import("./real-fixture").then(({ runRealFixture }) => runRealFixture())
    : run(),
});
