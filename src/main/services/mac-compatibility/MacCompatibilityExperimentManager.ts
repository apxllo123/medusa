import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  MacCompatibilityExperiment,
  MacCompatibilityGameKey,
  MacCompatibilityStack,
} from "./MacCompatibilityTypes.js";
import { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.js";

export interface MacCompatibilityExperimentManagerDependencies {
  registry?: MacCompatibilityRegistry;
  experimentsRoot?: string;
}

export class MacCompatibilityExperimentManager {
  private readonly registry: MacCompatibilityRegistry;
  private readonly experimentsRoot: string;

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
  }

  start(game: MacCompatibilityGameKey, stack: MacCompatibilityStack): MacCompatibilityExperiment {
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

    this.registry.addExperiment(game, experiment);
    this.registry.setSelectedStack(game, stack);
    return experiment;
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
  }

  cancel(game: MacCompatibilityGameKey, experimentId: string): void {
    this.registry.updateExperiment(game, experimentId, {
      status: "cancelled",
      finishedAt: new Date().toISOString(),
    });
  }

  /**
   * Promotion is deliberately separate from passing. A caller must have
   * already verified the real game working state before this method is used.
   */
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

  getExperiments(game: MacCompatibilityGameKey): MacCompatibilityExperiment[] {
    return this.registry.getExperiments(game);
  }

  getLastKnownGood(game: MacCompatibilityGameKey) {
    return this.registry.getLastKnownGood(game);
  }
}
