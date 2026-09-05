import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  MacCompatibilityGameKey,
  MacCompatibilityStack,
  MacCompatibilityExperiment,
  MacCompatibilityDiagnosticRecord,
  MacGameCompatibility,
  MacSystemInfo,
  MacWineVersion,
  MacWineEnvironment,
} from "./MacCompatibilityTypes.ts";
import type { MacCompatibilityAnalysis } from "./MacCompatibilityAnalyzer.ts";
import type { MacCompatibilityStackCandidate } from "./MacCompatibilityStackSelector.ts";
import {
  MacCompatibilityRecoveryEngine,
  type MacCompatibilityRecoveryEngineDependencies,
} from "./MacCompatibilityRecoveryEngine.ts";
import type { MacCompatibilityAnalyzer } from "./MacCompatibilityAnalyzer.ts";
import type { MacCompatibilityStackProvisioner } from "./MacCompatibilityStackProvisioner.ts";
import type { MacCompatibilityExperimentManager } from "./MacCompatibilityExperimentManager.ts";
import type { MacCompatibilityRecoveryPlanner } from "./MacCompatibilityRecoveryPlanner.ts";
import type { MacCompatibilityWorkingStateVerifier } from "./MacCompatibilityWorkingStateVerifier.ts";
import type { MacGameLaunchManager } from "./launch/MacGameLaunchManager.ts";
import type { MacCompatibilityProcessLogger } from "./MacCompatibilityProcessLogger.ts";
import type { MacScreenObserver } from "./MacScreenObservationTypes.ts";

const GAME: MacCompatibilityGameKey = {
  shop: "steam",
  objectId: "3751950",
};

const STACK: MacCompatibilityStack = {
  id: "wine:test+graphics:test-dx12",
  runtimeComponentId: "wine-test",
  runtimeFamily: "wine",
  graphicsComponentId: "test-dx12",
  toolingComponentIds: [],
  dependencyComponentIds: [],
  confidence: null,
  verified: false,
};

const CANDIDATE: MacCompatibilityStackCandidate = {
  stack: STACK,
  score: 100,
  eligible: true,
  reasons: ["test"],
};

const SYSTEM: MacSystemInfo = {
  platform: "macos",
  architecture: "arm64",
  osVersion: "unknown",
  computerName: "test",
  isAppleSilicon: true,
  isIntel: false,
  memoryBytes: 16 * 1024 ** 3,
  availableDiskBytes: 100 * 1024 ** 3,
  wineAvailable: true,
  protonAvailable: false,
  rosettaAvailable: true,
  compatibilityComponents: [],
};

const WINE: MacWineVersion = {
  id: "wine-test",
  name: "Test Wine",
  version: "test",
  type: "wine",
  executablePath: "/tmp/wine-test",
  isInstalled: true,
  isRecommended: true,
  architecture: "arm64",
  runtimeFamily: "wine",
};

const ANALYSIS: MacCompatibilityAnalysis = {
  systemInfo: SYSTEM,
  wineVersions: [WINE],
  requirements: null,
  candidates: [CANDIDATE],
  preferredStackId: null,
};

const ENVIRONMENT: MacWineEnvironment = {
  id: "experiment-1",
  prefixPath: "/tmp/experiment-prefix",
  wineVersionId: WINE.id,
  wineVersionName: WINE.name,
  architecture: "arm64",
  exists: true,
  initialized: true,
  healthy: true,
  installedComponents: ["wine-prefix"],
  createdAt: null,
  updatedAt: null,
};

const COMPATIBILITY: MacGameCompatibility = {
  shop: GAME.shop,
  objectId: GAME.objectId,
  title: "Assassin's Creed IV: Black Flag Resynced",
  status: "needs_setup",
  level: "fair",
  score: 100,
  isWindowsGame: true,
  requiresWine: true,
  requiresRosetta: true,
  recommendedWineVersionId: WINE.id,
  recommendedWineVersionName: WINE.name,
  environment: null,
  compatibilityStack: STACK,
  issues: [],
  recommendations: [],
};

class FakeAnalyzer {
  async analyze(): Promise<MacCompatibilityAnalysis> {
    return ANALYSIS;
  }
}

class FakeProvisioner {
  async provisionIsolated() {
    return {
      success: true,
      stack: STACK,
      environment: ENVIRONMENT,
      message: "ok",
      installedComponentIds: ["wine-prefix"],
    };
  }
}

class FakeExperimentManager {
  experiments: MacCompatibilityExperiment[] = [];
  diagnostics: MacCompatibilityDiagnosticRecord[] = [];
  promoted = false;

  start(): MacCompatibilityExperiment {
    const experiment: MacCompatibilityExperiment = {
      id: "experiment-1",
      stack: STACK,
      status: "pending",
      prefixPath: "/tmp/experiment-prefix",
      failureSignature: null,
      notes: [],
      startedAt: "2026-09-05T00:00:00.000Z",
      finishedAt: null,
    };
    this.experiments.push(experiment);
    return experiment;
  }

  markRunning(_game: MacCompatibilityGameKey, id: string) {
    const experiment = this.experiments.find((candidate) => candidate.id === id);
    if (experiment) experiment.status = "running";
  }

  markPassed(_game: MacCompatibilityGameKey, id: string) {
    const experiment = this.experiments.find((candidate) => candidate.id === id);
    if (experiment) experiment.status = "passed";
  }

  markFailed(_game: MacCompatibilityGameKey, id: string, signature: string) {
    const experiment = this.experiments.find((candidate) => candidate.id === id);
    if (experiment) {
      experiment.status = "failed";
      experiment.failureSignature = signature;
    }
  }

  promoteVerified() {
    this.promoted = true;
    return this.experiments[0];
  }

  addDiagnostic(
    _game: MacCompatibilityGameKey,
    diagnostic: MacCompatibilityDiagnosticRecord
  ) {
    this.diagnostics.push(diagnostic);
  }

  getExperiments() {
    return this.experiments;
  }

  getDiagnostics() {
    return this.diagnostics;
  }

  getLastKnownGood() {
    return null;
  }
}

class FakeLaunchManager {
  async launchInCompatibilityEnvironment() {
    return {
      success: true,
      pid: 123,
      compatibility: COMPATIBILITY,
      compatibilityStack: STACK,
      environment: ENVIRONMENT,
      wineVersion: WINE,
      logPaths: null,
      message: "launched",
    };
  }
}

class FakeProcessLogger {
  read() {
    return "";
  }
}

class FakeVerifier {
  constructor(private readonly verified: boolean) {}

  async verify() {
    return {
      verified: this.verified,
      reason: this.verified ? "game window visible" : "game failed",
      observation: null,
    };
  }
}

class FakeObserver {}

class FakePlanner {
  plan() {
    return [
      {
        id: "collect-more-evidence",
        action: "test" as const,
        title: "Collect more evidence",
        reason: "test",
        priority: 1,
      },
    ];
  }
}

const build = (verified: boolean) => {
  const experimentManager = new FakeExperimentManager();
  const dependencies: MacCompatibilityRecoveryEngineDependencies = {
    analyzer: new FakeAnalyzer() as unknown as MacCompatibilityAnalyzer,
    provisioner: new FakeProvisioner() as unknown as MacCompatibilityStackProvisioner,
    experimentManager: experimentManager as unknown as MacCompatibilityExperimentManager,
    recoveryPlanner: new FakePlanner() as unknown as MacCompatibilityRecoveryPlanner,
    launchManager: new FakeLaunchManager() as unknown as MacGameLaunchManager,
    processLogger: new FakeProcessLogger() as unknown as MacCompatibilityProcessLogger,
    screenObserver: new FakeObserver() as unknown as MacScreenObserver,
    workingStateVerifier: new FakeVerifier(verified) as unknown as MacCompatibilityWorkingStateVerifier,
  };

  return {
    engine: new MacCompatibilityRecoveryEngine(dependencies),
    experimentManager,
  };
};

describe("MacCompatibilityRecoveryEngine", () => {
  it("promotes a candidate only after working-state verification", async () => {
    const { engine, experimentManager } = build(true);

    const result = await engine.fixGame({
      game: GAME,
      title: COMPATIBILITY.title,
      executablePath: "/tmp/game.exe",
      isWindowsGame: true,
      maxAttempts: 1,
    });

    assert.equal(result.success, true);
    assert.equal(experimentManager.promoted, true);
    assert.equal(result.attempts[0]?.verified, true);
  });

  it("records a failed experiment when verification fails", async () => {
    const { engine, experimentManager } = build(false);

    const result = await engine.fixGame({
      game: GAME,
      title: COMPATIBILITY.title,
      executablePath: "/tmp/game.exe",
      isWindowsGame: true,
      maxAttempts: 1,
    });

    assert.equal(result.success, false);
    assert.equal(experimentManager.promoted, false);
    assert.equal(result.attempts[0]?.verified, false);
    assert.equal(experimentManager.experiments[0]?.status, "failed");
    assert.ok(experimentManager.diagnostics.length >= 1);
  });
});
