import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  MacCompatibilityGameKey,
  MacCompatibilityStack,
  MacWineEnvironment,
  MacWineVersion,
} from "./MacCompatibilityTypes.ts";
import type { MacCompatibilityStackCandidate } from "./MacCompatibilityStackSelector.ts";
import {
  MacCompatibilityStackProvisioner,
  type MacCompatibilityStackProvisionerDependencies,
} from "./MacCompatibilityStackProvisioner.ts";
import type { MacWineEnvironmentManager } from "./environment/MacWineEnvironmentManager.ts";

const GAME: MacCompatibilityGameKey = {
  shop: "steam",
  objectId: "black-flag-resynced-test",
};

const WINE: MacWineVersion = {
  id: "wine-arm64",
  name: "Wine ARM64",
  version: "test",
  type: "wine",
  executablePath: "/tmp/wine64",
  isInstalled: true,
  isRecommended: true,
  architecture: "arm64",
};

const STACK: MacCompatibilityStack = {
  id: `wine:${WINE.id}`,
  runtimeComponentId: WINE.id,
  graphicsComponentId: null,
  toolingComponentIds: [],
  dependencyComponentIds: [],
  confidence: null,
  verified: false,
};

const CANDIDATE: MacCompatibilityStackCandidate = {
  stack: STACK,
  score: 80,
  reasons: ["test"],
};

const makeEnvironment = (healthy: boolean): MacWineEnvironment => ({
  id: "env-1",
  prefixPath: "/tmp/medusa-test-prefix",
  wineVersionId: WINE.id,
  wineVersionName: WINE.name,
  architecture: "arm64",
  exists: true,
  initialized: true,
  healthy,
  installedComponents: ["wine-prefix"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

class FakeEnvironmentManager {
  public createCalls = 0;
  constructor(private environment: MacWineEnvironment | null) {}

  async getEnvironment(): Promise<MacWineEnvironment | null> {
    return this.environment;
  }

  async createEnvironment(
    _game: MacCompatibilityGameKey,
    _wineVersion: MacWineVersion
  ): Promise<MacWineEnvironment> {
    this.createCalls += 1;
    this.environment = makeEnvironment(true);
    return this.environment;
  }
}

const build = (environment: MacWineEnvironment | null) => {
  const fake = new FakeEnvironmentManager(environment);
  const dependencies: MacCompatibilityStackProvisionerDependencies = {
    environmentManager:
      fake as unknown as MacWineEnvironmentManager,
  };
  return {
    fake,
    provisioner: new MacCompatibilityStackProvisioner(dependencies),
  };
};

describe("MacCompatibilityStackProvisioner", () => {
  it("reuses an existing healthy environment", async () => {
    const { fake, provisioner } = build(makeEnvironment(true));

    const result = await provisioner.provision(GAME, CANDIDATE, [WINE]);

    assert.equal(result.success, true);
    assert.equal(result.environment?.id, "env-1");
    assert.equal(fake.createCalls, 0);
  });

  it("creates and verifies a missing environment", async () => {
    const { fake, provisioner } = build(null);

    const result = await provisioner.provision(GAME, CANDIDATE, [WINE]);

    assert.equal(result.success, true);
    assert.equal(result.environment?.healthy, true);
    assert.equal(fake.createCalls, 1);
  });

  it("fails without a selected runtime", async () => {
    const { provisioner } = build(null);
    const candidate: MacCompatibilityStackCandidate = {
      ...CANDIDATE,
      stack: { ...STACK, runtimeComponentId: null },
    };

    const result = await provisioner.provision(GAME, candidate, [WINE]);

    assert.equal(result.success, false);
    assert.match(result.message, /does not specify a runtime/i);
  });

  it("fails when the selected runtime is not installed", async () => {
    const { provisioner } = build(null);

    const result = await provisioner.provision(GAME, CANDIDATE, []);

    assert.equal(result.success, false);
    assert.match(result.message, /not installed/i);
  });

  it("does not promote an unhealthy newly-created environment", async () => {
    class UnhealthyEnvironmentManager extends FakeEnvironmentManager {
      override async createEnvironment(): Promise<MacWineEnvironment> {
        this.createCalls += 1;
        return makeEnvironment(false);
      }
    }

    const fake = new UnhealthyEnvironmentManager(null);
    const provisioner = new MacCompatibilityStackProvisioner({
      environmentManager:
        fake as unknown as MacWineEnvironmentManager,
    });

    const result = await provisioner.provision(GAME, CANDIDATE, [WINE]);

    assert.equal(result.success, false);
    assert.equal(result.environment?.healthy, false);
    assert.equal(fake.createCalls, 1);
  });
});
