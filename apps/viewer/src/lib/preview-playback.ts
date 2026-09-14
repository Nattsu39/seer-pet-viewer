import type { PlayResult } from "@seer-pet-anim/anim-export/playback";

export interface PreviewPlaybackPlayer {
  play(): void;
  pause(): void;
  setLoop(loop: boolean): void;
  playSequence(name: string, options: { loop: boolean }): PlayResult;
}

export interface PreviewPlaybackState {
  sequence: string;
  playing: boolean;
  playbackEnded: boolean;
  mountError: string | null;
}

/** Resume with the viewer's preferred loop mode; completed runs need a new selection. */
export function togglePreviewPlayback(
  player: PreviewPlaybackPlayer,
  state: PreviewPlaybackState,
  loop = true,
): void {
  if (state.playing) {
    player.pause();
    state.playing = false;
    return;
  }
  if (state.playbackEnded) {
    const result = player.playSequence(state.sequence, { loop });
    if (!result.ok) {
      state.mountError = `动作不可播放: ${result.reason}`;
      return;
    }
    state.playbackEnded = false;
  } else {
    player.setLoop(loop);
    player.play();
  }
  state.mountError = null;
  state.playing = true;
}

export function playPreviewOnce(
  player: PreviewPlaybackPlayer,
  state: PreviewPlaybackState,
): void {
  const result = player.playSequence(state.sequence, { loop: false });
  if (!result.ok) {
    state.mountError = `动作不可播放: ${result.reason}`;
    return;
  }
  state.playbackEnded = false;
  state.mountError = null;
  state.playing = true;
}
