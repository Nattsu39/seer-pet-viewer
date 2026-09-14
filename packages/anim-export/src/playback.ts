/** Source markers are never interpreted as battle/skill completion. Times are seconds. */
export interface AnimationMarker {
  time: number;
  name: string;
  data?: unknown;
}
export interface AnimationSequence {
  name: string;
  duration: number;
  markers: readonly AnimationMarker[];
  playable: boolean;
}
export type PlaybackEvent = {
  type: "marker" | "complete" | "cancel";
  playbackId: number;
  sequence: string;
  time: number;
  cycle: number;
  marker?: AnimationMarker;
  reason?: "replaced" | "cancelled" | "destroyed";
};
export type PlayResult =
  | { ok: true; playbackId: number }
  | {
      ok: false;
      reason: "missing" | "unplayable" | "destroyed" | "interrupted";
    };

/** Deterministic clock. Selection/seek are silent; first positive advance visits time zero.
 * At loop boundaries end markers precede next-cycle zero markers. Listener reentry
 * invalidates the remainder of the old dispatch. Recursive advance is ignored.
 */
export class PlaybackClock {
  private listeners = new Set<(event: PlaybackEvent) => void>();
  private generation = 0;
  private revision = 0;
  private sequence: AnimationSequence | null = null;
  private elapsed = 0;
  private initial = true;
  private lastMarker: { cycle: number; index: number } | null = null;
  private ended = false;
  private destroyed = false;
  private advancing = false;
  playing = false;
  loop = true;
  private rate = 1;
  get time(): number {
    const d = this.sequence?.duration ?? 0;
    return this.loop && d > 0 ? this.elapsed % d : Math.min(this.elapsed, d);
  }
  get playbackId(): number {
    return this.generation;
  }
  subscribe(listener: (event: PlaybackEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setSpeed(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0)
      throw new RangeError("speed must be finite and non-negative");
    this.rate = rate;
  }
  select(sequence: AnimationSequence): number | null {
    const revision = this.revision;
    this.cancel("replaced");
    // Nested selection/destruction wins over the interrupted outer request.
    if (this.destroyed || this.revision !== revision + 1) return null;
    this.sequence = sequence;
    this.elapsed = 0;
    this.initial = true;
    this.lastMarker = null;
    this.ended = false;
    this.revision++;
    return ++this.generation;
  }
  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) throw new RangeError("time must be finite");
    this.elapsed = Math.max(0, Math.min(seconds, this.sequence?.duration ?? 0));
    this.initial = false;
    this.lastMarker = null;
    this.revision++;
  }
  cancel(reason: PlaybackEvent["reason"] = "cancelled"): void {
    const seq = this.sequence;
    const pending = seq && !this.ended;
    this.playing = false;
    this.ended = true;
    this.revision++;
    if (pending)
      this.emit({
        type: "cancel",
        playbackId: this.generation,
        sequence: seq.name,
        time: this.time,
        cycle: 0,
        reason,
      });
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancel("destroyed");
    this.listeners.clear();
  }
  private emit(event: PlaybackEvent): void {
    const revision = this.revision;
    for (const listener of [...this.listeners]) {
      if (revision !== this.revision) break;
      if (this.listeners.has(listener)) {
        try {
          listener(event);
        } catch (error) {
          // Observer errors must not strand playback or prevent GPU cleanup.
          if (typeof globalThis.reportError === "function")
            globalThis.reportError(error);
          else console.error(error);
        }
      }
    }
  }
  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new RangeError("delta must be finite and non-negative seconds");
    if (!Number.isFinite(seconds * this.rate + this.elapsed))
      throw new RangeError("advance exceeds finite timeline range");
    const seq = this.sequence;
    if (
      this.advancing ||
      this.destroyed ||
      !this.playing ||
      this.ended ||
      !seq ||
      seconds * this.rate === 0
    )
      return;
    this.advancing = true;
    try {
      const revision = this.revision,
        start = this.elapsed,
        duration = seq.duration;
      const end =
        this.loop && duration > 0
          ? start + seconds * this.rate
          : Math.min(duration, start + seconds * this.rate);
      const first = this.initial;
      this.initial = false;
      const pausedOnMarker =
        this.lastMarker &&
        this.lastMarker.cycle * duration +
          seq.markers[this.lastMarker.index].time ===
          start;
      const firstCycle = pausedOnMarker
        ? this.lastMarker!.cycle
        : duration > 0
          ? Math.floor(start / duration)
          : 0;
      const lastCycle =
        this.loop && duration > 0 ? Math.floor(end / duration) : 0;
      for (
        let cycle = this.loop ? firstCycle : 0;
        cycle <= lastCycle;
        cycle++
      ) {
        for (let index = 0; index < seq.markers.length; index++) {
          const marker = seq.markers[index];
          const at = cycle * duration + marker.time;
          const pendingAtStart =
            at === start &&
            this.lastMarker !== null &&
            (cycle > this.lastMarker.cycle ||
              (cycle === this.lastMarker.cycle &&
                index > this.lastMarker.index));
          if (
            at > end ||
            (at <= start && !(first && at === 0) && !pendingAtStart)
          )
            continue;
          this.lastMarker = { cycle, index };
          this.elapsed = at;
          this.emit({
            type: "marker",
            playbackId: this.generation,
            sequence: seq.name,
            time: marker.time,
            cycle,
            marker,
          });
          if (revision !== this.revision || !this.playing) return;
        }
      }
      this.elapsed = end;
      if ((!this.loop || duration === 0) && end >= duration) {
        this.ended = true;
        this.playing = false;
        this.emit({
          type: "complete",
          playbackId: this.generation,
          sequence: seq.name,
          time: duration,
          cycle: 0,
        });
      }
    } finally {
      this.advancing = false;
    }
  }
}
