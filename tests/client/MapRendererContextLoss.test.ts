import type { Config } from "../../src/core/configuration/Config";

// jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Stand-in for GPURenderer: records the canvas each instance was built on and
// fails construction while `failOn` says so (a dead or software context).
const built: HTMLCanvasElement[] = [];
let failOn: (canvas: HTMLCanvasElement) => boolean = () => false;

vi.mock("../../src/client/render/gl/Renderer", () => ({
  GPURenderer: class {
    glLimited = null;
    constructor(canvas: HTMLCanvasElement) {
      if (failOn(canvas)) throw new Error("context unavailable");
      built.push(canvas);
    }
    resize() {}
    dispose() {}
  },
}));

const { MapRenderer } = await import("../../src/client/render/gl/MapRenderer");

function lose(canvas: HTMLCanvasElement): void {
  canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
}

function restore(canvas: HTMLCanvasElement): void {
  canvas.dispatchEvent(new Event("webglcontextrestored"));
}

function setup() {
  const canvas = document.createElement("canvas");
  canvas.id = "webgl-debug-canvas";
  document.body.appendChild(canvas);
  const view = new MapRenderer(
    canvas,
    { mapWidth: 4, mapHeight: 4, unitTypes: [], players: [], maxPlayers: 4 },
    () => new Uint8Array(16),
    new Float32Array(4),
    {} as Config,
    {} as never,
  );
  const restored = vi.fn();
  const replaced = vi.fn();
  const lost = vi.fn();
  view.onContextRestored = restored;
  view.onCanvasReplaced = replaced;
  view.onRenderLost = lost;
  return { canvas, view, restored, replaced, lost };
}

describe("MapRenderer context loss recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    built.length = 0;
    failOn = () => false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("rebuilds on the same canvas when the browser restores", () => {
    const { canvas, view, restored, replaced } = setup();

    lose(canvas);
    restore(canvas);
    vi.advanceTimersByTime(10_000);

    expect(built).toEqual([canvas, canvas]);
    expect(restored).toHaveBeenCalledTimes(1);
    expect(replaced).not.toHaveBeenCalled();
    expect(view.canvasElement).toBe(canvas);
  });

  it("swaps in a fresh canvas when the browser never restores", () => {
    const { canvas, view, restored, replaced, lost } = setup();

    lose(canvas);
    vi.advanceTimersByTime(2_999);
    expect(replaced).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    const fresh = view.canvasElement;
    expect(fresh).not.toBe(canvas);
    expect(fresh.id).toBe("webgl-debug-canvas");
    expect(fresh.isConnected).toBe(true);
    expect(canvas.isConnected).toBe(false);
    expect(replaced).toHaveBeenCalledWith(fresh);
    expect(built[built.length - 1]).toBe(fresh);
    expect(restored).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
  });

  it("ignores a late restore from the abandoned canvas", () => {
    const { canvas, restored } = setup();

    lose(canvas);
    vi.advanceTimersByTime(3_000);
    restore(canvas);

    expect(restored).toHaveBeenCalledTimes(1);
  });

  it("replaces the canvas at once when the restored rebuild fails", () => {
    const { canvas, view, restored, replaced } = setup();

    failOn = (c) => c === canvas;
    lose(canvas);
    restore(canvas);

    expect(replaced).toHaveBeenCalledTimes(1);
    expect(view.canvasElement).not.toBe(canvas);
    expect(restored).toHaveBeenCalledTimes(1);
  });

  it("reports the map lost when a fresh canvas fails too", () => {
    const { canvas, lost, restored } = setup();

    failOn = () => true;
    lose(canvas);
    vi.advanceTimersByTime(3_000);

    expect(lost).toHaveBeenCalledTimes(1);
    expect(restored).not.toHaveBeenCalled();
  });

  it("stops replacing after repeated losses", () => {
    const { view, replaced, lost } = setup();

    for (let i = 0; i < 4; i++) {
      lose(view.canvasElement);
      vi.advanceTimersByTime(3_000);
    }

    expect(replaced).toHaveBeenCalledTimes(3);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("does nothing after dispose", () => {
    const { canvas, view, replaced, lost } = setup();

    lose(canvas);
    view.dispose();
    vi.advanceTimersByTime(10_000);

    expect(replaced).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
  });
});
