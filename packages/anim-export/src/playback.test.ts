import { describe, expect, it } from "vitest";
import { PlaybackClock, type PlaybackEvent } from "./playback.js";

function setup(
  duration = 1,
  markers = [
    { name: "start", time: 0 },
    { name: "action_hit", time: 0.5 },
    { name: "end", time: 1 },
  ],
) {
  const clock = new PlaybackClock(),
    events: PlaybackEvent[] = [];
  clock.subscribe((event) => events.push(event));
  clock.select({ name: "attack", duration, markers, playable: true });
  clock.loop = false;
  clock.playing = true;
  return { clock, events };
}
describe("controlled playback", () => {
  it("holds the final frame until its full duration and completes once", () => {
    const { clock, events } = setup();
    clock.advance(0.9);
    expect(events.map((e) => e.type)).toEqual(["marker", "marker"]);
    clock.advance(0.1);
    clock.advance(10);
    expect(events.map((e) => e.type)).toEqual([
      "marker",
      "marker",
      "marker",
      "complete",
    ]);
  });
  it("preserves pause and applies speed once", () => {
    const { clock } = setup();
    clock.advance(0.2);
    clock.playing = false;
    clock.advance(10);
    expect(clock.time).toBe(0.2);
    clock.playing = true;
    clock.setSpeed(2);
    clock.advance(0.2);
    expect(clock.time).toBeCloseTo(0.6);
  });
  it("seeks silently without replaying historical events", () => {
    const { clock, events } = setup();
    clock.seek(0.75);
    clock.advance(0);
    expect(events).toEqual([]);
    clock.advance(0.25);
    expect(events.map((e) => e.marker?.name ?? e.type)).toEqual([
      "end",
      "complete",
    ]);
  });
  it("visits multiple loops in chronological order with end before start", () => {
    const { clock, events } = setup();
    clock.loop = true;
    clock.advance(2);
    expect(events.map((e) => `${e.cycle}:${e.marker?.name}`)).toEqual([
      "0:start",
      "0:action_hit",
      "0:end",
      "1:start",
      "1:action_hit",
      "1:end",
      "2:start",
    ]);
    clock.advance(0);
    expect(events).toHaveLength(7);
  });
  it("handles missing markers, single frames and zero duration", () => {
    for (const duration of [0, 1 / 24]) {
      const { clock, events } = setup(duration, []);
      clock.advance(1);
      expect(events.map((e) => e.type)).toEqual(["complete"]);
    }
  });
  it("stops old dispatch when callbacks change sequence or destroy", () => {
    for (const destroy of [false, true]) {
      const { clock, events } = setup();
      clock.subscribe((event) => {
        if (event.type !== "marker") return;
        if (destroy) clock.destroy();
        else {
          clock.select({
            name: "new",
            duration: 3,
            markers: [],
            playable: true,
          });
          clock.playing = true;
        }
      });
      clock.advance(10);
      expect(events.map((e) => e.type)).toEqual(["marker", "cancel"]);
      expect(events[1].reason).toBe(destroy ? "destroyed" : "replaced");
    }
  });
  it("preserves duplicate source markers and safely unsubscribes", () => {
    const { clock, events } = setup(1, [
      { name: "hit", time: 0 },
      { name: "hit", time: 0 },
    ]);
    const off = clock.subscribe(() => {
      throw new Error("unsubscribed");
    });
    off();
    clock.advance(1);
    expect(events.filter((e) => e.type === "marker")).toHaveLength(2);
  });
  it("cancel and destroy never report success", () => {
    const { clock, events } = setup();
    clock.cancel();
    clock.destroy();
    clock.destroy();
    clock.advance(10);
    expect(events.map((e) => e.type)).toEqual(["cancel"]);
  });
  it("resumes remaining simultaneous markers and loop zero markers after a callback pauses", () => {
    const { clock, events } = setup(1, [
      { name: "start", time: 0 },
      { name: "a", time: 1 },
      { name: "b", time: 1 },
    ]);
    clock.loop = true;
    const off = clock.subscribe((event) => {
      if (event.marker?.name === "a") clock.playing = false;
    });
    clock.advance(2);
    off();
    clock.playing = true;
    clock.advance(0.1);
    expect(events.map((e) => e.marker?.name)).toEqual([
      "start",
      "a",
      "b",
      "start",
    ]);
  });
  it("a selection inside cancellation wins and every replaced instance terminates", () => {
    const { clock, events } = setup();
    clock.subscribe((event) => {
      if (event.type === "cancel")
        clock.select({
          name: "nested",
          duration: 2,
          markers: [],
          playable: true,
        });
    });
    const result = clock.select({
      name: "outer",
      duration: 2,
      markers: [],
      playable: true,
    });
    expect(result).toBeNull();
    expect(events).toHaveLength(1);
    clock.playing = true;
    clock.advance(2);
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      sequence: "nested",
    });
  });
});
