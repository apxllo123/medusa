import type {
  MacCompatibilityGameKey,
  MacCompatibilityStack,
  MacWineEnvironment,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";
import type { MacCompatibilityStackCandidate } from "./MacCompatibilityStackSelector.js";
import { MacWineEnvironmentManager } from "./environment/MacWineEnvironmentManager.js";

/**
 * Result of preparing a candidate stack for a game.
 *
 * The provisioner is deliberately conservative: it reuses an existing
 * healthy environment and only creates a new Wine environment when the
 * selected candidate explicitly names an available Wine runtime. Graphics
 * and tooling installation are kept out of this first pass so the
 * provisioner cannot silently copy or replace external components it does
 * not own yet.
 */
export interface MacCompatibilityStackProvisionResult {
  success: boolean;
  stack: MacCompatibilityStack;
  environment: MacWineEnvironment | null;
  message: string;
  installedComponentIds: string[];
}

export interface MacCompatibilityStackProvisionerDependencies {
  environmentManager?: MacWineEnvironmentManager;
}

export class MacCompatibilityStackProvisioner {
  private readonly environmentManager: MacWineEnvironmentManager;

  constructor(dependencies?: MacCompatibilityStackProvisionerDependencies) {
    this.environmentManager =
      dependencies?.environmentManager ?? new MacWineEnvironmentManager();
  }

  async provision(
    game: MacCompatibilityGameKey,
    candidate: MacCompatibilityStackCandidate,
    wineVersions: MacWineVersion[]
  ): Promise<MacCompatibilityStackProvisionResult> {
    const { stack } = candidate;

    if (!stack.runtimeComponentId) {
      return {
        success: false,
        stack,
        environment: null,
        message: "Compatibility stack does not specify a runtime component.",
        installedComponentIds: [],
      };
    }

    const wineVersion = wineVersions.find(
      (wine) => wine.id === stack.runtimeComponentId
    );

    if (!wineVersion) {
      return {
        success: false,
        stack,
        environment: null,
        message: `Runtime component ${stack.runtimeComponentId} is not installed.`,
        installedComponentIds: [],
      };
    }

    const existing = await this.environmentManager.getEnvironment(game);

    if (existing?.exists && existing.initialized && existing.healthy) {
      return {
        success: true,
        stack,
        environment: existing,
        message: "Reused the existing healthy compatibility environment.",
        installedComponentIds: existing.installedComponents,
      };
    }

    try {
      const environment = await this.environmentManager.createEnvironment(
        game,
        wineVersion
      );

      if (!environment.initialized) {
        return {
          success: false,
          stack,
          environment,
          message: "Runtime environment was created but was not initialized.",
          installedComponentIds: environment.installedComponents,
        };
      }

      if (!environment.healthy) {
        return {
          success: false,
          stack,
          environment,
          message: "Runtime environment was created but did not pass health checks.",
          installedComponentIds: environment.installedComponents,
        };
      }

      return {
        success: true,
        stack,
        environment,
        message: "Compatibility runtime provisioned and verified.",
        installedComponentIds: environment.installedComponents,
      };
    } catch (error) {
      return {
        success: false,
        stack,
        environment: null,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while provisioning the compatibility stack.",
        installedComponentIds: [],
      };
    }
  }
}
