import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MacCompatibilityDiagnosticRecord } from "./MacCompatibilityTypes.ts";
import { MacCompatibilityRecoveryPlanner } from "./MacCompatibilityRecoveryPlanner.ts";

const diagnostic = (
  text: string,
  signature: string | null = null
): MacCompatibilityDiagnosticRecord => ({
  id: "diagnostic-test",
  failureSignature: signature,
  evidence: [
    {
      source: "runtime",
      text,
      timestamp: "2026-09-05T00:00:00.000Z",
      confidence: 1,
    },
  ],
  summary: "test",
  createdAt: "2026-09-05T00:00:00.000Z",
});

describe("MacCompatibilityRecoveryPlanner", () => {
  it("prioritizes graphics recovery for DX12 device failures", () => {
    const planner = new MacCompatibilityRecoveryPlanner();
    const candidates = planner.plan(
      [diagnostic("DXGI_ERROR_DEVICE_HUNG 0x887A0006")],
      false
    );

    assert.equal(candidates[0]?.action, "change-stack");
    assert.equal(candidates[1]?.action, "inspect-gpu-trace");
  });

  it("recognizes shader-cache failures", () => {
    const planner = new MacCompatibilityRecoveryPlanner();
    const candidates = planner.plan(
      [diagnostic("E_INVALIDARG while loading SHADER CACHE")],
      true
    );

    assert.ok(
      candidates.some((candidate) => candidate.action === "reset-shader-cache")
    );
  });

  it("falls back to collecting evidence when nothing actionable is known", () => {
    const planner = new MacCompatibilityRecoveryPlanner();
    const candidates = planner.plan([diagnostic("unknown startup message")], true);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.action, "test");
  });
});
