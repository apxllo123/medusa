import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  MacCompatibilityDiagnosticRecord,
} from "./MacCompatibilityTypes.ts";
import type { MacScreenObservationResult } from "./MacScreenObservationTypes.ts";
import {
  MacCompatibilityWorkingStateVerifier,
} from "./MacCompatibilityWorkingStateVerifier.ts";

const observation = (
  overrides: Partial<MacScreenObservationResult> = {}
): MacScreenObservationResult => ({
  captured: true,
  source: "window",
  windowId: 42,
  windowTitle: "Assassin's Creed IV: Black Flag",
  imagePath: null,
  observations: [],
  combinedText: "Main Menu",
  error: null,
  ...overrides,
});

class FakeScreenObserver {
  constructor(private readonly result: MacScreenObservationResult) {}

  async captureWindow() {
    return this.result;
  }

  async captureFocusedGameWindow() {
    return this.result;
  }
}

const failedDiagnostic: MacCompatibilityDiagnosticRecord = {
  id: "d1",
  failureSignature: "DXGI_ERROR_DEVICE_HUNG",
  evidence: [],
  summary: "failure",
  createdAt: "2026-09-05T00:00:00.000Z",
};

describe("MacCompatibilityWorkingStateVerifier", () => {
  it("verifies the Black Flag window when no fatal evidence is visible", async () => {
    const verifier = new MacCompatibilityWorkingStateVerifier({
      screenObserver: new FakeScreenObserver(observation()),
    });

    const result = await verifier.verify("steam", "3751950");

    assert.equal(result.verified, true);
    assert.match(result.reason, /expected game window/i);
  });

  it("rejects a visible fatal error", async () => {
    const verifier = new MacCompatibilityWorkingStateVerifier({
      screenObserver: new FakeScreenObserver(
        observation({ combinedText: "FATAL ERROR: Failed to initialize D3D12" })
      ),
    });

    const result = await verifier.verify("steam", "3751950");

    assert.equal(result.verified, false);
    assert.match(result.reason, /fatal-error signature/i);
  });

  it("rejects a runtime failure even when the window is visible", async () => {
    const verifier = new MacCompatibilityWorkingStateVerifier({
      screenObserver: new FakeScreenObserver(observation()),
    });

    const result = await verifier.verify("steam", "3751950", [
      failedDiagnostic,
    ]);

    assert.equal(result.verified, false);
    assert.match(result.reason, /runtime diagnostics/i);
  });

  it("does not claim verification when screen capture is unavailable", async () => {
    const verifier = new MacCompatibilityWorkingStateVerifier({
      screenObserver: new FakeScreenObserver(
        observation({
          captured: false,
          source: "none",
          windowId: null,
          windowTitle: null,
          combinedText: "",
          error: "permission denied",
        })
      ),
    });

    const result = await verifier.verify("steam", "3751950");

    assert.equal(result.verified, false);
    assert.match(result.reason, /permission denied/i);
  });
});
