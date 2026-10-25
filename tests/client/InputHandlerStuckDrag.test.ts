import {
  DragEvent,
  InputHandler,
  MouseOverEvent,
} from "../../src/client/InputHandler";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";

/** jsdom's PointerEvent drops pointerId/pointerType/buttons, so fake one. */
function dispatchPointer(
  target: EventTarget,
  type: string,
  props: {
    pointerType?: string;
    button?: number;
    buttons?: number;
    clientX?: number;
    clientY?: number;
  },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType: "mouse",
    button: -1,
    clientX: 0,
    clientY: 0,
    ...props,
  });
  target.dispatchEvent(event);
}

function setup() {
  const canvas = document.createElement("div");
  document.body.appendChild(canvas);

  const eventBus = new EventBus();
  const drags: DragEvent[] = [];
  const hovers: MouseOverEvent[] = [];
  eventBus.on(DragEvent, (e) => drags.push(e));
  eventBus.on(MouseOverEvent, (e) => hovers.push(e));

  const gameView = { inSpawnPhase: () => false } as unknown as GameView;
  const handler = new InputHandler(gameView, {} as UIState, canvas, eventBus);
  handler.initialize();

  return { canvas, handler, drags, hovers };
}

describe("InputHandler drag with a lost mouse release (Safari)", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.handler.destroy();
    ctx.canvas.remove();
  });

  it("pans while the left button is held", () => {
    dispatchPointer(ctx.canvas, "pointerdown", { button: 0, buttons: 1 });
    dispatchPointer(window, "pointermove", { buttons: 1, clientX: 30 });

    expect(ctx.drags).toHaveLength(1);
  });

  it("stops panning once a move reports no button held", () => {
    dispatchPointer(ctx.canvas, "pointerdown", { button: 0, buttons: 1 });
    dispatchPointer(window, "pointermove", { buttons: 1, clientX: 30 });
    // The pointerup never arrives; the next move has the button up.
    dispatchPointer(window, "pointermove", { buttons: 0, clientX: 60 });
    dispatchPointer(window, "pointermove", { buttons: 0, clientX: 90 });

    expect(ctx.drags).toHaveLength(1);
    expect(ctx.hovers).toHaveLength(2);
  });

  it("leaves touch drags to their own release path", () => {
    dispatchPointer(ctx.canvas, "pointerdown", {
      pointerType: "touch",
      button: 0,
      buttons: 1,
    });
    // Some browsers report buttons 0 on touch moves; that is not a release.
    dispatchPointer(window, "pointermove", {
      pointerType: "touch",
      buttons: 0,
      clientX: 30,
    });

    expect(ctx.drags).toHaveLength(1);
  });
});
