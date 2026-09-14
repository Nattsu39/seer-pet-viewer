import { expect, it } from "vitest";
import { PlaybackClock } from "../../../../packages/anim-export/src/playback";
import {
  playPreviewOnce,
  togglePreviewPlayback,
  type PreviewPlaybackState,
} from "./preview-playback";

function setup() {
  const clock = new PlaybackClock();
  const sequence = { name: "attack", duration: 1, markers: [], playable: true };
  const state: PreviewPlaybackState = {
    sequence: sequence.name,
    playing: true,
    playbackEnded: false,
    mountError: null,
  };
  const player = {
    play: () => {
      clock.playing = true;
    },
    pause: () => {
      clock.playing = false;
    },
    setLoop: (loop: boolean) => {
      clock.loop = loop;
    },
    playSequence: (_name: string, options: { loop: boolean }) => {
      const playbackId = clock.select(sequence)!;
      clock.loop = options.loop;
      clock.playing = true;
      state.playbackEnded = false;
      return { ok: true as const, playbackId };
    },
  };
  clock.subscribe((event) => {
    if (event.type === "complete" || event.type === "cancel") {
      state.playbackEnded = true;
      state.playing = false;
    }
  });
  player.playSequence("attack", { loop: false });
  return { clock, player, state };
}

it.each(["complete", "cancel"])(
  "ordinary play restarts after %s and keeps looping",
  (end) => {
    const { clock, player, state } = setup();
    if (end === "complete") clock.advance(1);
    else clock.cancel();
    togglePreviewPlayback(player, state);
    clock.advance(1.25);
    expect(clock.time).toBeCloseTo(0.25);
    expect(state.playing).toBe(true);
    expect(state.playbackEnded).toBe(false);
  },
);

it("pause then ordinary play preserves the pose and switches one-shot to looping", () => {
  const { clock, player, state } = setup();
  clock.advance(0.4);
  const id = clock.playbackId;
  togglePreviewPlayback(player, state);
  clock.advance(1);
  expect(clock.time).toBeCloseTo(0.4);
  togglePreviewPlayback(player, state);
  expect(clock.playbackId).toBe(id);
  expect(clock.time).toBeCloseTo(0.4);
  clock.advance(0.8);
  expect(clock.time).toBeCloseTo(0.2);
});

it("play once restarts from zero, stops at the end, and can be repeated", () => {
  const { clock, player, state } = setup();
  clock.advance(0.4);
  for (let run = 0; run < 2; run++) {
    const previousId = clock.playbackId;
    playPreviewOnce(player, state);
    expect(clock.playbackId).toBeGreaterThan(previousId);
    expect(clock.time).toBe(0);
    expect(clock.loop).toBe(false);
    expect(state.playing).toBe(true);
    clock.advance(1.25);
    expect(clock.time).toBe(1);
    expect(state.playing).toBe(false);
    expect(state.playbackEnded).toBe(true);
  }
});

it.each([true, false])(
  "ordinary play restores loop preference %s after one-shot",
  (loop) => {
    const { clock, player, state } = setup();
    playPreviewOnce(player, state);
    clock.advance(1);
    togglePreviewPlayback(player, state, loop);
    expect(clock.loop).toBe(loop);
    clock.advance(1.25);
    expect(clock.time).toBeCloseTo(loop ? 0.25 : 1);
    expect(state.playing).toBe(loop);
  },
);
