import type {
  MacCompatibilityAction,
  MacCompatibilityDiagnosticRecord,
} from "./MacCompatibilityTypes.js";

export interface MacCompatibilityRecoveryCandidate {
  id: string;
  action: MacCompatibilityAction;
  title: string;
  reason: string;
  priority: number;
}

/**
 * Converts observed evidence into testable recovery hypotheses. This planner
 * never declares a fix by itself; every candidate still has to be tested and
 * verified by the experiment/observation pipeline.
 */
export class MacCompatibilityRecoveryPlanner {
  plan(
    diagnostics: MacCompatibilityDiagnosticRecord[],
    hasKnownGood: boolean
  ): MacCompatibilityRecoveryCandidate[] {
    const text = diagnostics
      .flatMap((diagnostic) => [
        diagnostic.failureSignature ?? "",
        ...diagnostic.evidence.map((evidence) => evidence.text),
      ])
      .join("\n")
      .toUpperCase();

    const candidates: MacCompatibilityRecoveryCandidate[] = [];

    if (/DXGI|D3D12|DEVICE_HUNG|DEVICE_REMOVED|D3D11/.test(text)) {
      candidates.push({
        id: "try-alternate-graphics-stack",
        action: "change-stack",
        title: "Try an alternate graphics stack",
        reason: "The evidence contains a DirectX/graphics-device failure.",
        priority: 100,
      });

      candidates.push({
        id: "inspect-gpu-trace",
        action: "inspect-gpu-trace",
        title: "Inspect the GPU workload",
        reason: "A graphics-device failure can require Metal/GPU trace evidence before choosing the next fix.",
        priority: 80,
      });
    }

    if (/SHADER|DXCACHE|GLCACHE|CACHE|E_INVALIDARG|0X80070057/.test(text)) {
      candidates.push({
        id: "reset-shader-cache",
        action: "reset-shader-cache",
        title: "Reset the affected shader/cache state",
        reason: "The evidence suggests a shader or graphics-cache failure.",
        priority: 90,
      });
    }

    if (/OVERLAY|RENDERDOC|RTSS|AFTERBURNER|REShade/.test(text)) {
      candidates.push({
        id: "disable-graphics-overlays",
        action: "disable-overlays",
        title: "Retry without graphics overlays",
        reason: "The evidence mentions an overlay or graphics injection layer.",
        priority: 85,
      });
    }

    if (/PREFIX|WINE|WINEDLLOVERRIDES|WINEBOOT|SYSTEM\.REG|DRIVE_C/.test(text)) {
      candidates.push({
        id: "repair-compatibility-environment",
        action: "repair",
        title: "Repair the compatibility environment",
        reason: "The evidence points to a runtime/prefix initialization problem.",
        priority: 75,
      });
    }

    if (!hasKnownGood) {
      candidates.push({
        id: "try-next-ranked-stack",
        action: "change-stack",
        title: "Try the next ranked compatibility stack",
        reason: "No verified working configuration exists yet, so another eligible stack should be tested.",
        priority: 60,
      });
    }

    if (candidates.length === 0) {
      candidates.push({
        id: "collect-more-evidence",
        action: "test",
        title: "Collect another diagnostic sample",
        reason: "The current evidence is insufficient to choose a targeted correction safely.",
        priority: 50,
      });
    }

    const unique = new Map<string, MacCompatibilityRecoveryCandidate>();
    for (const candidate of candidates) {
      const existing = unique.get(candidate.id);
      if (!existing || candidate.priority > existing.priority) {
        unique.set(candidate.id, candidate);
      }
    }

    return Array.from(unique.values()).sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id)
    );
  }
}
