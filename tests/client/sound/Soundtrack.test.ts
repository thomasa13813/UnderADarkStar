import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const howlInstances: any[] = [];

vi.mock("howler", () => {
  class MockHowl {
    src: string;
    loop: boolean;
    html5: boolean;
    // Howler queues play() on a Howl that has not loaded and returns at once,
    // and only emits "play" when the media element really starts. For an
    // html5 stream that gap is a network fetch, so the test double has to
    // model it: calling play() here makes no sound, and `begin()` is what
    // playback starting looks like.
    play = vi.fn();
    stop = vi.fn();
    unload = vi.fn();
    fade = vi.fn();
    volume = vi.fn(() => 0);
    // Zero until the stream's metadata arrives, like Howler's.
    duration = vi.fn(() => 0);
    seek = vi.fn((): unknown => 0);
    _listeners = new Map<string, Set<() => void>>();
    once = vi.fn((event: string, cb: () => void) => {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(cb);
    });
    off = vi.fn((event: string, cb?: () => void) => {
      if (cb === undefined) this._listeners.delete(event);
      else this._listeners.get(event)?.delete(cb);
    });
    _fire(event: string) {
      const listeners = this._listeners.get(event);
      if (listeners === undefined) return;
      for (const cb of Array.from(listeners)) {
        listeners.delete(cb);
        cb();
      }
    }
    /** Playback actually starting, which is what arms the ramp. */
    begin() {
      this._fire("play");
    }
    /** The stream reporting it is `remaining` seconds from the end. */
    nearEnd(remaining: number) {
      this.duration.mockReturnValue(180);
      this.seek.mockReturnValue(180 - remaining);
    }
    constructor(opts: any) {
      this.src = opts.src[0];
      this.loop = opts.loop ?? false;
      this.html5 = opts.html5 ?? false;
      howlInstances.push(this);
    }
  }
  return { Howl: MockHowl, Howler: { volume: vi.fn() } };
});

import {
  CROSSFADE_MS,
  POSITION_POLL_MS,
  SOUNDTRACK,
  Soundtrack,
} from "../../../src/client/sound/Soundtrack";

// Rebuilt per test: these carry implementations, which clearAllMocks keeps but
// restoreAllMocks would not.
let mixer: any;
let musicLevel: number;
// The channel as the sliders have it, ignoring the focus duck -- which is
// exactly the distinction isAudible draws and volumeFor does not.
let musicAudible: boolean;
let player: Soundtrack | null = null;

const buildMixer = () => {
  // Real defaults: slider 0.5, squared by perceptualGain, times the -1 dB
  // music trim.
  musicLevel = 0.5 * 0.5 * 0.89;
  musicAudible = true;
  mixer = {
    register: vi.fn(),
    unregister: vi.fn(),
    volumeFor: vi.fn(() => musicLevel),
    isAudible: vi.fn(() => musicAudible),
  };
};

beforeEach(() => {
  howlInstances.length = 0;
  vi.clearAllMocks();
  buildMixer();
  vi.useFakeTimers();
});

afterEach(() => {
  player?.dispose();
  player = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const track = (file: string) =>
  howlInstances.find((h) => h.src.endsWith(`/${file}`));

const volumeWrites = (howl: any): number[] =>
  howl.volume.mock.calls
    .filter((c: unknown[]) => c.length > 0)
    .map((c: unknown[]) => c[0] as number);

/** Most recent volume a ramp wrote at this Howl. */
const lastVolume = (howl: any) => {
  const writes = volumeWrites(howl);
  return writes[writes.length - 1];
};

/** Builds the player and gives it the gesture that starts the first track. */
const startOnGesture = () => {
  player = new Soundtrack(mixer);
  document.dispatchEvent(new Event("pointerdown"));
  return track(SOUNDTRACK[0].file);
};

/** First track up and settled, so the next case starts from a steady state. */
const settledFirstTrack = () => {
  const first = startOnGesture();
  first.begin();
  vi.advanceTimersByTime(2100);
  return first;
};

/** Runs the poll until the current track reports it is near its end. */
const reachCrossfadePoint = (current: any) => {
  current.nearEnd(CROSSFADE_MS / 1000 - 0.1);
  vi.advanceTimersByTime(POSITION_POLL_MS);
};

describe("starting", () => {
  it("streams the first track rather than decoding it up front", () => {
    player = new Soundtrack(mixer);
    // Browsers block audio until a gesture, so nothing is built before one.
    expect(howlInstances).toHaveLength(0);

    document.dispatchEvent(new Event("pointerdown"));
    const first = track(SOUNDTRACK[0].file);
    expect(first).toBeDefined();
    // A playlist advances itself; a looping track would never end.
    expect(first.loop).toBe(false);
    // Megabytes decoded up front is a wait landing exactly when the player
    // has just clicked something, so the tracks stream.
    expect(first.html5).toBe(true);
    expect(first.play).toHaveBeenCalled();
  });

  it("starts once however many gestures arrive", () => {
    startOnGesture();
    document.dispatchEvent(new Event("keydown"));
    document.dispatchEvent(new Event("pointerdown"));
    player!.play();
    expect(howlInstances).toHaveLength(1);
    expect(howlInstances[0].play).toHaveBeenCalledTimes(1);
  });

  it("can be started by a game instead of a gesture", () => {
    player = new Soundtrack(mixer);
    player.play();
    expect(track(SOUNDTRACK[0].file).play).toHaveBeenCalled();
    // The gesture that follows must not start a second copy over it.
    document.dispatchEvent(new Event("pointerdown"));
    expect(howlInstances).toHaveLength(1);
  });

  it("ramps up from silence in even dB steps", () => {
    const first = startOnGesture();
    first.begin();
    // Registering writes the channel volume straight onto the Howl, which
    // would snap the track in at full level. It has to wait for the ramp.
    expect(mixer.register).not.toHaveBeenCalled();
    expect(lastVolume(first)).toBeLessThan(musicLevel * 0.01);

    vi.advanceTimersByTime(1000);
    // Linear in dB: halfway through the ramp is halfway up the 48 dB climb,
    // i.e. -24 dB, not the -6 dB a linear-amplitude fade would be at.
    expect(lastVolume(first)).toBeCloseTo(musicLevel * 10 ** (-24 / 20), 3);

    vi.advanceTimersByTime(1100);
    expect(mixer.register).toHaveBeenCalledWith(first, "music");
  });

  it("waits for playback to start before ramping", () => {
    const first = startOnGesture();
    // Still fetching: nothing written above the floor, nothing registered.
    vi.advanceTimersByTime(5000);
    expect(mixer.register).not.toHaveBeenCalled();
    for (const v of volumeWrites(first)) expect(v).toBeLessThan(0.01);
  });

  it("tracks the slider mid-ramp without restarting it", () => {
    const first = startOnGesture();
    first.begin();
    vi.advanceTimersByTime(1000);
    musicLevel = musicLevel / 2;
    vi.advanceTimersByTime(25);
    // The new level, at the ramp's existing position.
    expect(lastVolume(first)).toBeCloseTo(musicLevel * 10 ** (-24 / 20), 2);
  });

  it("hands a muted channel straight to the mixer instead of ramping", () => {
    musicAudible = false;
    const first = startOnGesture();
    first.begin();
    expect(mixer.register).toHaveBeenCalledWith(first, "music");
  });

  it("listens for a gesture again when playback is blocked", () => {
    player = new Soundtrack(mixer);
    // A game opened by URL asks before any click: the autoplay rule says no.
    player.play();
    const blocked = track(SOUNDTRACK[0].file);
    blocked._fire("playerror");
    expect(blocked.unload).toHaveBeenCalled();

    document.dispatchEvent(new Event("pointerdown"));
    const retry = howlInstances[1];
    expect(retry).toBeDefined();
    // The same track, not the one after it: nothing was heard.
    expect(retry.src).toBe(blocked.src);
    expect(retry.play).toHaveBeenCalled();
  });
});

describe("advancing", () => {
  it("has the next track fetching as soon as the current one starts", () => {
    const first = startOnGesture();
    expect(track(SOUNDTRACK[1].file)).toBeUndefined();
    first.begin();
    const second = track(SOUNDTRACK[1].file);
    expect(second).toBeDefined();
    // Buffering, not sounding.
    expect(second.play).not.toHaveBeenCalled();
    // One ahead only.
    expect(track(SOUNDTRACK[2].file)).toBeUndefined();
  });

  it("crossfades into the next track as the current one nears its end", () => {
    const first = settledFirstTrack();
    const second = track(SOUNDTRACK[1].file);

    reachCrossfadePoint(first);
    expect(second.play).toHaveBeenCalled();
    // The mixer would stamp the channel level over the curve on the next
    // slider move, so the outgoing track leaves its hands first.
    expect(mixer.unregister).toHaveBeenCalledWith(first);

    second.begin();
    vi.advanceTimersByTime(CROSSFADE_MS / 2);
    const out = lastVolume(first);
    const inn = lastVolume(second);
    // Equal power: both at cos(45°) of the level at the midpoint, and the
    // squares summing to the level squared, so the join does not dip.
    expect(out).toBeCloseTo(musicLevel * Math.SQRT1_2, 2);
    expect(inn).toBeCloseTo(musicLevel * Math.SQRT1_2, 2);
    expect(out * out + inn * inn).toBeCloseTo(musicLevel * musicLevel, 2);

    vi.advanceTimersByTime(CROSSFADE_MS / 2 + 100);
    expect(first.stop).toHaveBeenCalled();
    expect(first.unload).toHaveBeenCalled();
    expect(mixer.register).toHaveBeenLastCalledWith(second, "music");
  });

  it("does not start the crossfade before the stream has a duration", () => {
    const first = settledFirstTrack();
    const second = track(SOUNDTRACK[1].file);
    // Metadata not in yet: Howler reports 0, and an unknown length is not a
    // short one.
    first.duration.mockReturnValue(0);
    first.seek.mockReturnValue(0);
    vi.advanceTimersByTime(POSITION_POLL_MS * 4);
    expect(second.play).not.toHaveBeenCalled();

    // And the Howl itself comes back from seek() while play-locked.
    first.duration.mockReturnValue(180);
    first.seek.mockReturnValue(first);
    vi.advanceTimersByTime(POSITION_POLL_MS * 4);
    expect(second.play).not.toHaveBeenCalled();
  });

  it("opens the next track from silence when the current one runs out first", () => {
    const first = settledFirstTrack();
    const second = track(SOUNDTRACK[1].file);
    // No crossfade happened -- a hidden tab's throttled timer missed it.
    first._fire("end");
    expect(second.play).toHaveBeenCalled();
    expect(first.unload).toHaveBeenCalled();

    second.begin();
    // Nothing left to fade out of, so the usual dB ramp rather than the
    // equal-power curve, which would arrive 12 dB hotter at the midpoint.
    vi.advanceTimersByTime(1000);
    expect(lastVolume(second)).toBeCloseTo(musicLevel * 10 ** (-24 / 20), 3);
    vi.advanceTimersByTime(1100);
    expect(mixer.register).toHaveBeenLastCalledWith(second, "music");
  });

  it("switches without a ramp when the channel is muted", () => {
    const first = settledFirstTrack();
    const second = track(SOUNDTRACK[1].file);
    musicAudible = false;
    reachCrossfadePoint(first);
    second.begin();
    expect(first.unload).toHaveBeenCalled();
    expect(mixer.register).toHaveBeenLastCalledWith(second, "music");
  });

  it("wraps round to the first track after the last", () => {
    let current = settledFirstTrack();
    for (let i = 1; i < SOUNDTRACK.length; i++) {
      reachCrossfadePoint(current);
      const next = track(SOUNDTRACK[i].file);
      expect(next.play).toHaveBeenCalled();
      next.begin();
      vi.advanceTimersByTime(CROSSFADE_MS + 100);
      current = next;
    }
    reachCrossfadePoint(current);
    const again = howlInstances.filter((h) =>
      h.src.endsWith(`/${SOUNDTRACK[0].file}`),
    );
    expect(again).toHaveLength(2);
    expect(again[1].play).toHaveBeenCalled();
  });

  it("skips a track that will not load", () => {
    const first = settledFirstTrack();
    const second = track(SOUNDTRACK[1].file);
    // The preloaded one fails while buffering: gone, and fetched afresh when
    // its turn comes, since a CDN blip should not cost the track for good.
    second._fire("loaderror");
    expect(second.unload).toHaveBeenCalled();

    reachCrossfadePoint(first);
    const retry = howlInstances.filter((h) => h.src === second.src)[1];
    expect(retry.play).toHaveBeenCalled();
    // Now it fails as the current track: on to the one after it.
    retry._fire("loaderror");
    expect(retry.unload).toHaveBeenCalled();
    expect(track(SOUNDTRACK[2].file).play).toHaveBeenCalled();
  });
});

describe("teardown", () => {
  it("stops, unloads and unregisters everything it holds", () => {
    const first = settledFirstTrack();
    const second = track(SOUNDTRACK[1].file);
    player!.dispose();
    player = null;
    expect(mixer.unregister).toHaveBeenCalledWith(first);
    expect(first.stop).toHaveBeenCalled();
    expect(first.unload).toHaveBeenCalled();
    expect(second.unload).toHaveBeenCalled();
    // The gesture listeners went too.
    document.dispatchEvent(new Event("pointerdown"));
    expect(howlInstances).toHaveLength(2);
  });
});
