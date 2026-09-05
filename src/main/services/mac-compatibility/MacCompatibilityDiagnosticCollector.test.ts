import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDiagnosticRecord,
  createProcessDiagnosticEvidence,
  normalizeDiagnosticSignature,
} from "./MacCompatibilityDiagnosticCollector.ts";

describe("MacCompatibilityDiagnosticCollector", () => {
  it("normalizes unstable addresses and whitespace", () => {
    const signature = normalizeDiagnosticSignature(
      "DXGI\u001b[31m ERROR\u001b[0m 0x80070057   build 1.2.3"
    );

    assert.equal(signature, "DXGI ERROR 0XADDR BUILD VERSION");
  });

  it("returns null for empty diagnostic text", () => {
    assert.equal(normalizeDiagnosticSignature("   \n\t "), null);
  });

  it("creates process/runtime evidence without inventing screen evidence", () => {
    const evidence = createProcessDiagnosticEvidence(
      "stdout message",
      "stderr message"
    );

    assert.deepEqual(
      evidence.map((item) => item.source),
      ["process", "runtime"]
    );
    assert.ok(evidence.every((item) => item.confidence === 1));
  });

  it("creates a stable diagnostic record from collected evidence", () => {
    const record = createDiagnosticRecord([
      {
        source: "screen",
        text: "Game failed to initialize D3D12",
        timestamp: "2026-09-05T00:00:00.000Z",
        confidence: 0.96,
      },
    ]);

    assert.match(record.id, /^diagnostic-/);
    assert.equal(record.failureSignature, "GAME FAILED TO INITIALIZE D3D12");
    assert.equal(record.evidence.length, 1);
  });
});
