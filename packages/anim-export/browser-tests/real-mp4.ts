import { MaterialResolver } from "@seer-pet-anim/swf-bundle";
import {
  loadMaterialBundle,
  parseBundle,
} from "@seer-pet-anim/swf-bundle/parse";
import { SwfPlayer } from "@seer-pet-anim/swf-renderer";
import { parseSpineBundle } from "@seer-pet-anim/spine-bundle";
import { SpinePlayer } from "@seer-pet-anim/spine-renderer";
import { exportAnimation, type ExportOptions } from "../src/index.js";
import { playVideo } from "./mp4.js";

type Player = SwfPlayer | SpinePlayer;

export async function runRealMp4BrowserTests() {
  console.info("MP4 test: parsing real SWF and Spine fixtures");
  const resolver = new MaterialResolver();
  await loadMaterialBundle(await fetchFixture("materials"), resolver);
  const swf = await parseBundle(
    await fetchFixture("swf"),
    "ppets_4911",
    resolver,
  );
  const spine = await parseSpineBundle(
    await fetchFixture("spine"),
    "pskilltimeline_spines_0",
  );
  const results = [];
  for (const kind of ["swf", "spine"] as const) {
    const host = document.createElement("div");
    host.style.cssText = "width:640px;height:480px";
    document.body.append(host);
    const player = kind === "swf" ? new SwfPlayer() : new SpinePlayer();
    try {
      if (player instanceof SwfPlayer)
        await player.mount(host, swf, { clock: "manual" });
      else await player.mount(host, spine, { clock: "manual" });
      results.push(...(await verifyPlayerExports(player, host, kind)));
    } finally {
      player.destroy();
      host.remove();
    }
  }
  return results;
}

async function fetchFixture(name: string): Promise<ArrayBuffer> {
  const response = await fetch(`/mp4-fixtures/${name}`);
  if (!response.ok) throw new Error(`Missing real fixture ${name}`);
  return response.arrayBuffer();
}

async function verifyPlayerExports(
  player: Player,
  host: HTMLElement,
  kind: "swf" | "spine",
) {
  const names = player.getSequences().map((sequence) => sequence.name);
  const sequence = names.find((name) => name === "standby") ?? names[0]!;
  player.setSequence(sequence);
  player.setSpeed(2);
  player.seek(0.2);
  player.play();
  const savedTime = player.getTime();
  const options: ExportOptions = {
    sequence,
    scale: 0.25,
    background: 0x243f61,
    format: "mp4",
  };
  await verifyCaptureSnapshot(player, host, options, names);
  await verifyCancellationRestoresPlayback(player, options);
  const results = [
    await verifyVideoExport(player, options, `${kind}-single`),
    await verifyVideoExport(
      player,
      { ...options, scale: 1, battle: { side: "left", kind } },
      `${kind}-battle`,
    ),
  ];
  player.advance(0.01);
  if (Math.abs(player.getTime() - savedTime - 0.02) > 0.00001) {
    throw new Error(`${kind}: playback speed or playing state not restored`);
  }
  await verifyDestroyedPlayerCleanup(player, options);
  return results;
}

async function verifyCancellationRestoresPlayback(
  player: Player,
  options: ExportOptions,
) {
  const savedTime = player.getTime();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await expectAbort(
      exportAnimation(
        player,
        { ...options, signal: controller.signal },
        ({ phase }) => {
          if (phase === "capture") controller.abort();
        },
      ),
    );
  } finally {
    clearTimeout(timer);
  }
  if (player.getTime() !== savedTime)
    throw new Error("Cancellation did not restore playback");
}

async function verifyVideoExport(
  player: Player,
  options: ExportOptions,
  name: string,
) {
  console.info(`MP4 test: exporting ${name} ${options.sequence}`);
  const savedTime = player.getTime();
  const blob = await exportAnimation(player, options);
  if (player.getTime() !== savedTime)
    throw new Error(`${name}: export changed playback time`);
  const reference = await measureReferenceGeometry(player, options);
  const playback = await playVideo(blob);
  if (
    playback.width !== reference.width + (reference.width % 2) ||
    playback.height !== reference.height + (reference.height % 2)
  ) {
    throw new Error(`${name}: MP4/GIF geometry mismatch`);
  }
  return {
    name,
    sequence: options.sequence,
    frameCount: player.getSequenceFrameCount(options.sequence),
    fps: player.getExportFps(),
    ...playback,
    bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
  };
}

async function measureReferenceGeometry(
  player: Player,
  options: ExportOptions,
) {
  if (options.battle) {
    // Use GIF's transparent frame source without accumulating a legacy 1080p GIF.
    for await (const frame of player.captureFrames({
      ...options,
      background: "transparent",
      maxSide: 4096,
    })) {
      return { width: frame.width, height: frame.height };
    }
    throw new Error("No reference frames");
  }
  const gif = await exportAnimation(player, {
    ...options,
    format: "gif",
    background: "transparent",
  });
  const header = new DataView(await gif.slice(0, 10).arrayBuffer());
  return {
    width: header.getUint16(6, true),
    height: header.getUint16(8, true),
  };
}

async function verifyDestroyedPlayerCleanup(
  player: Player,
  options: ExportOptions,
) {
  const controller = new AbortController();
  await expectAbort(
    exportAnimation(
      player,
      {
        ...options,
        viewport: { width: 160, height: 120 },
        signal: controller.signal,
      },
      ({ phase }) => {
        if (phase === "capture") {
          controller.abort();
          player.destroy();
        }
      },
    ),
  );
}

async function expectAbort(task: Promise<unknown>) {
  try {
    await task;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  }
  throw new Error("Canceled export returned a downloadable file");
}

async function verifyCaptureSnapshot(
  player: Player,
  host: HTMLElement,
  options: ExportOptions,
  sequences: string[],
) {
  const captureOptions = {
    ...options,
    background: "transparent" as const,
    viewport: { width: 160, height: 120 },
  };
  const reference = [];
  for await (const frame of player.captureFrames(captureOptions)) {
    reference.push(frame);
    if (reference.length === 2) break;
  }
  let index = 0;
  for await (const frame of player.captureFrames(captureOptions)) {
    const expected = reference[index]!;
    if (
      frame.width !== expected.width ||
      frame.height !== expected.height ||
      frame.pixels.some((value, offset) => value !== expected.pixels[offset])
    ) {
      throw new Error(
        "Preview edits changed an active capture's sequence, background, or viewport",
      );
    }
    if (++index === 2) break;
    player.setSequence(
      sequences.find((name) => name !== options.sequence) ?? options.sequence,
    );
    player.setBackgroundColor(0xff0000);
    player.fitToView();
    player.setViewportPosition(1000, 1000);
    player.setZoom(3);
    host.style.width = "700px";
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }
  if (
    player instanceof SpinePlayer &&
    player.getCanvas().width !== Math.floor(700 * devicePixelRatio)
  ) {
    throw new Error("Deferred preview resize was not applied after capture");
  }
  host.style.width = "640px";
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
