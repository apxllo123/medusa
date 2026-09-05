import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  MacCompatibilityDiagnosticRecord,
  MacCompatibilityExperiment,
  MacCompatibilityGameKey,
  MacCompatibilityStack,
} from "./MacCompatibilityTypes.js";
import { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.js";
import {
  DEFAULT_MAC_COMPATIBILITY_RESOURCE_BUDGET,
  MacCompatibilityResourceGuard,
  type MacCompatibilityResourceBudget,
} from "./MacCompatibilityResourceGuard.js";

export interface MacCompatibilityExperimentManagerDependencies {
  registry?: MacCompatibilityRegistry;
  experimentsRoot?: string;
  resourceGuard?: MacCompatibilityResourceGuard;
  resourceBudget?: MacCompatibilityResourceBudget;
}

export class MacCompatibilityExperimentManager {
  private readonly registry: MacCompatibilityRegistry;
  private readonly experimentsRoot: string;
  private readonly resourceGuard: MacCompatibilityResourceGuard;
  private readonly releases = new Map<string, () => void>();

  constructor(dependencies?: MacCompatibilityExperimentManagerDependencies) {
    this.registry = dependencies?.registry ?? new MacCompatibilityRegistry();
    this.experimentsRoot =
      dependencies?.experimentsRoot ??
      join(
        process.env.HOME ?? "",
        "Library",
        "Application Support",
        "Hydra",
        "mac-compatibility",
        "experiments"
      );
    this.resourceGuard =
      dependencies?.resourceGuard ??
      new MacCompatibilityResourceGuard(
        dependencies?.resourceBudget ?? DEFAULT_MAC_COMPATIBILITY_RESOURCE_BUDGET
      );
  }

  start(
    game: MacCompatibilityGameKey,
    stack: MacCompatibilityStack,
    availableDiskBytes: number
  ): MacCompatibilityExperiment {
    const release = this.resourceGuard.acquire(availableDiskBytes);
    const id = randomUUID();
    const experiment: MacCompatibilityExperiment = {
      id,
      stack,
      status: "pending",
      prefixPath: join(this.experimentsRoot, game.shop, game.objectId, id),
      failureSignature: null,
      notes: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    try {
      this.registry.addExperiment(game, experiment);
      this.registry.setSelectedStack(game, stack);
      this.releases.set(id, release);
      return experiment;
    } catch (error) {
      release();
      throw error;
    }
  }

  markRunning(game: MacCompatibilityGameKey, experimentId: string): void {
    this.registry.updateExperiment(game, experimentId, { status: "running" });
  }

  markPassed(
    game: MacCompatibilityGameKey,
    experimentId: string,
    notes: string[] = []
  ): void {
    this.registry.updateExperiment(game, experimentId, {
      status: "passed",
      notes,
      finishedAt: new Date().toISOString(),
    });
    this.release(experimentId);
  }

  markFailed(
    game: MacCompatibilityGameKey,
    experimentId: string,
    failureSignature: string,
    notes: string[] = []
  ): void {
    this.registry.updateExperiment(game, experimentId, {
      status: "failed",
      failureSignature,
      notes,
      finishedAt: new Date().toISOString(),
    });
    this.release(experimentId);
  }

  cancel(game: MacCompatibilityGameKey, experimentId: string): void {
    this.registry.updateExperiment(game, experimentId, {
      status: "cancelled",
      finishedAt: new Date().toISOString(),
    });
    this.release(experimentId);
  }

  promoteVerified(
    game: MacCompatibilityGameKey,
    experimentId: string,
    verificationNotes: string[] = []
  ): MacCompatibilityExperiment {
    const experiment = this.registry
      .getExperiments(game)
      .find((candidate) => candidate.id === experimentId);

    if (!experiment) {
      throw new Error(`Compatibility experiment ${experimentId} was not found.`);
    }

    if (experiment.status !== "passed") {
      throw new Error(
        `Compatibility experiment ${experimentId} must be passed before promotion.`
      );
    }

    const stack = {
      ...experiment.stack,
      confidence: 1,
      verified: true,
    };

    this.registry.setLastKnownGood(game, {
      stack,
      verifiedAt: new Date().toISOString(),
      experimentId,
    });

    this.registry.updateExperiment(game, experimentId, {
      stack,
      notes: [...experiment.notes, ...verificationNotes],
    });

    return {
      ...experiment,
      stack,
      notes: [...experiment.notes, ...verificationNotes],
    };
  }

  addDiagnostic(
    game: MacCompatibilityGameKey,
    diagnostic: MacCompatibilityDiagnosticRecord
  ): void {
    this.registry.addDiagnostic(game, diagnostic);
  }

  getDiagnostics(game: MacCompatibilityGameKey): MacCompatibilityDiagnosticRecord[] {
    return this.registry.getDiagnostics(game);
  }

  getExperiments(game: MacCompatibilityGameKey): MacCompatibilityExperiment[] {
    return this.registry.getExperiments(game);
  }

  getLastKnownGood(game: MacCompatibilityGameKey) {
    return this.registry.getLastKnownGood(game);
  }

  private release(experimentId: string): void {
    const release = this.releases.get(experimentId);
    if (!release) return;
    this.releases.delete(experimentId);
    release();
  }
}
