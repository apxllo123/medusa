import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  MacCompatibilityExperiment,
  MacCompatibilityGameKey,
  MacCompatibilityStack,
  MacCompatibilityRegistryEntry,
} from "./MacCompatibilityTypes.ts";
import { MacCompatibilityExperimentManager } from "./MacCompatibilityExperimentManager.ts";
import type { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.ts";

const GAME: MacCompatibilityGameKey = {
  shop: "steam",
  objectId: "black-flag-resynced-test",
};

const STACK: MacCompatibilityStack = {
  id: "wine:wine-arm64",
  runtimeComponentId: "wine-arm64",
  graphicsComponentId: null,
  toolingComponentIds: [],
  dependencyComponentIds: [],
  confidence: null,
  verified: false,
};

class FakeRegistry {
  private entry: MacCompatibilityRegistryEntry | null = null;

  addExperiment(
    key: MacCompatibilityGameKey,
    experiment: MacCompatibilityExperiment
  ) {
    this.entry = this.entry ?? {
      key,
      environment: null,
      selectedWineVersionId: null,
      selectedStack: null,
      lastKnownGood: null,
      experiments: [],
      lastStatus: "unknown",
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    };
    this.entry = {
      ...this.entry,
      experiments: [...(this.entry.experiments ?? []), experiment],
    };
  }

  setSelectedStack(
    _key: MacCompatibilityGameKey,
    stack: MacCompatibilityStack | null
  ) {
    if (!this.entry) return;
    this.entry = { ...this.entry, selectedStack: stack };
  }

  updateExperiment(
    _key: MacCompatibilityGameKey,
    experimentId: string,
    update: Partial<MacCompatibilityExperiment>
  ) {
    if (!this.entry) return;
    this.entry = {
      ...this.entry,
      experiments: (this.entry.experiments ?? []).map((experiment) =>
        experiment.id === experimentId ? { ...experiment, ...update } : experiment
      ),
    };
  }

  getExperiments() {
    return this.entry?.experiments ?? [];
  }

  getLastKnownGood() {
    return this.entry?.lastKnownGood ?? null;
  }
}

describe("MacCompatibilityExperimentManager", () => {
  it("persists an experiment with an isolated prefix path", () => {
    const registry = new FakeRegistry();
    const manager = new MacCompatibilityExperimentManager({
      registry: registry as unknown as MacCompatibilityRegistry,
      experimentsRoot: "/tmp/medusa-experiments",
    });

    const experiment = manager.start(GAME, STACK);

    assert.equal(experiment.status, "pending");
    assert.match(experiment.prefixPath ?? "", /black-flag-resynced-test/);
    assert.match(experiment.prefixPath ?? "", experiment.id);
    assert.equal(registry.getExperiments().length, 1);
  });

  it("records a failed experiment and its failure signature", () => {
    const registry = new FakeRegistry();
    const manager = new MacCompatibilityExperimentManager({
      registry: registry as unknown as MacCompatibilityRegistry,
      experimentsRoot: "/tmp/medusa-experiments",
    });

    const experiment = manager.start(GAME, STACK);
    manager.markRunning(GAME, experiment.id);
    manager.markFailed(GAME, experiment.id, "DXGI_DEVICE_REMOVED", [
      "graphics initialization failed",
    ]);

    const saved = registry.getExperiments()[0];
    assert.equal(saved?.status, "failed");
    assert.equal(saved?.failureSignature, "DXGI_DEVICE_REMOVED");
    assert.deepEqual(saved?.notes, ["graphics initialization failed"]);
    assert.ok(saved?.finishedAt);
  });

  it("does not report a last-known-good configuration unless one exists", () => {
    const registry = new FakeRegistry();
    const manager = new MacCompatibilityExperimentManager({
      registry: registry as unknown as MacCompatibilityRegistry,
    });

    assert.equal(manager.getLastKnownGood(GAME), null);
  });
});
