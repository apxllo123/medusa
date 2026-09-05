import type { MacScreenObservationResult, MacScreenObserver } from "./MacScreenObservationTypes.js";
import type { MacCompatibilityDiagnosticRecord } from "./MacCompatibilityTypes.js";

export interface MacCompatibilityWorkingStateExpectation {
  windowTitlePatterns: RegExp[];
  fatalTextPatterns: RegExp[];
}

export interface MacCompatibilityWorkingStateResult {
  verified: boolean;
  reason: string;
  observation: MacScreenObservationResult | null;
}

const DEFAULT_FATAL_PATTERNS = [
  /fatal error/i,
  /failed to initialize/i,
  /could not start/i,
  /not responding/i,
  /device removed/i,
  /device hung/i,
  /dxgi_error/i,
  /d3d12/i,
  /crash/i,
];

const EXPECTATIONS: Record<string, MacCompatibilityWorkingStateExpectation> = {
  "steam:3751950": {
    windowTitlePatterns: [/assassin'?s creed/i, /black flag/i],
    fatalTextPatterns: DEFAULT_FATAL_PATTERNS,
  },
};

export function getWorkingStateExpectation(
  shop: string,
  objectId: string
): MacCompatibilityWorkingStateExpectation {
  return (
    EXPECTATIONS[`${shop}:${objectId}`] ?? {
      windowTitlePatterns: [],
      fatalTextPatterns: DEFAULT_FATAL_PATTERNS,
    }
  );
}

export interface MacCompatibilityWorkingStateVerifierDependencies {
  screenObserver: MacScreenObserver;
}

/**
 * Verifies an observable startup state. A spawned process by itself is never
 * treated as proof of compatibility. When ScreenCaptureKit is unavailable,
 * verification stays false so an experiment cannot be promoted incorrectly.
 */
export class MacCompatibilityWorkingStateVerifier {
  private readonly screenObserver: MacScreenObserver;

  constructor(dependencies: MacCompatibilityWorkingStateVerifierDependencies) {
    this.screenObserver = dependencies.screenObserver;
  }

  async verify(
    shop: string,
    objectId: string,
    diagnostics: MacCompatibilityDiagnosticRecord[] = []
  ): Promise<MacCompatibilityWorkingStateResult> {
    const expectation = getWorkingStateExpectation(shop, objectId);
    const observation = await this.screenObserver.captureFocusedGameWindow();

    if (!observation.captured) {
      return {
        verified: false,
        reason:
          observation.error ??
          "The game window could not be observed, so compatibility cannot be verified.",
        observation,
      };
    }

    const visibleText = `${observation.windowTitle ?? ""}\n${observation.combinedText}`;
    const fatalMatch = expectation.fatalTextPatterns.find((pattern) =>
      pattern.test(visibleText)
    );

    if (fatalMatch) {
      return {
        verified: false,
        reason: `Visible fatal-error signature matched: ${fatalMatch.source}`,
        observation,
      };
    }

    const diagnosticFailure = diagnostics.find((diagnostic) =>
      /FAILED|FATAL|CRASH|ERROR|DEVICE HUNG|DEVICE REMOVED/.test(
        diagnostic.failureSignature ?? ""
      )
    );

    if (diagnosticFailure) {
      return {
        verified: false,
        reason: `Runtime diagnostics still report a failure: ${diagnosticFailure.failureSignature}`,
        observation,
      };
    }

    if (expectation.windowTitlePatterns.length === 0) {
      return {
        verified: true,
        reason: "A live game window was captured and no fatal error evidence was visible.",
        observation,
      };
    }

    const titleMatch = expectation.windowTitlePatterns.some((pattern) =>
      pattern.test(observation.windowTitle ?? "")
    );

    if (!titleMatch) {
      return {
        verified: false,
        reason: `Observed window title "${observation.windowTitle ?? "(unknown)"}" did not match the expected game title.`,
        observation,
      };
    }

    return {
      verified: true,
      reason: "Expected game window is visible and no fatal error evidence was observed.",
      observation,
    };
  }
}
