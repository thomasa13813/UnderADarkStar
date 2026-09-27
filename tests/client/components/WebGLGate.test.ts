import { afterEach, describe, expect, it } from "vitest";
import {
  WebGLGate,
  type WebGLGateStatus,
} from "../../../src/client/components/WebGLGate";

describe("webgl-gate", () => {
  let gate: WebGLGate | undefined;

  afterEach(() => {
    gate?.remove();
  });

  async function mount(status: WebGLGateStatus): Promise<WebGLGate> {
    gate = new WebGLGate();
    gate.status = status;
    document.body.appendChild(gate);
    await gate.updateComplete;
    return gate;
  }

  it("shows browser instructions", async () => {
    await mount("unsupported");

    expect(gate!.textContent).toContain("Google Chrome");
  });

  it("keeps the fingerprinting warning when WebGL is limited", async () => {
    await mount("limited");

    expect(gate!.textContent).toContain("Your browser is limiting WebGL");
  });
});
