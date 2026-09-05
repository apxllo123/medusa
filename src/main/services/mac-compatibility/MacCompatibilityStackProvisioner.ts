import type {
  MacCompatibilityGameKey,
  MacCompatibilityStack,
  MacWineEnvironment,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";
import type { MacCompatibilityStackCandidate } from "./MacCompatibilityStackSelector.js";
import { MacWineEnvironmentManager } from "./environment/MacWineEnvironmentManager.js";
import { MacIsolatedWineEnvironment } from "./environment/MacIsolatedWineEnvironment.js";

export interface MacCompatibilityStackProvisionResult {
  success: boolean;
  stack: MacCompatibilityStack;
  environment: MacWineEnvironment | null;
  message: string;
  installedComponentIds: string[];
}

export interface MacCompatibilityStackProvisionerDependencies {
  environmentManager?: MacWineEnvironmentManager;
  isolatedEnvironment?: MacIsolatedWineEnvironment;
}

export class MacCompatibilityStackProvisioner {
  private readonly environmentManager: MacWineEnvironmentManager;
  private readonly isolatedEnvironment: MacIsolatedWineEnvironment;

  constructor(dependencies?: MacCompatibilityStackProvisionerDependencies) {
    this.environmentManager =
      dependencies?.environmentManager ?? new MacWineEnvironmentManager();
    this.isolatedEnvironment =
      dependencies?.isolatedEnvironment ?? new MacIsolatedWineEnvironment();
  }

  async provision(
    game: MacCompatibilityGameKey,
    candidate: MacCompatibilityStackCandidate,
    wineVersions: MacWineVersion[]
  ): Promise<MacCompatibilityStackProvisionResult> {
    return this.provisionInternal(game, candidate, wineVersions, null);
  }

  async provisionIsolated(
    game: MacCompatibilityGameKey,
    candidate: MacCompatibilityStackCandidate,
    wineVersions: MacWineVersion[],
    prefixPath: string
  ): Promise<MacCompatibilityStackProvisionResult> {
    return this.provisionInternal(game, candidate, wineVersions, prefixPath);
  }

  private async provisionInternal(
    game: MacCompatibilityGameKey,
    candidate: MacCompatibilityStackCandidate,
    wineVersions: MacWineVersion[],
    isolatedPrefixPath: string | null
  ): Promise<MacCompatibilityStackProvisionResult> {
    const { stack } = candidate;

    if (!candidate.eligible) {
      return {
        success: false,
        stack,
        environment: null,
        message: "Compatibility stack is not currently eligible for this game.",
        installedComponentIds: [],
      };
    }

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

    try {
      if (isolatedPrefixPath) {
        const environment = await this.isolatedEnvironment.create(
          game,
          wineVersion,
          isolatedPrefixPath
        );

        if (!environment.initialized || !environment.healthy) {
          return {
            success: false,
            stack,
            environment,
            message:
              "Isolated runtime environment was created but did not pass health checks.",
            installedComponentIds: environment.installedComponents,
          };
        }

        return {
          success: true,
          stack,
          environment,
          message: "Isolated compatibility runtime provisioned and verified.",
          installedComponentIds: environment.installedComponents,
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

      const environment = await this.environmentManager.createEnvironment(
        game,
        wineVersion
      );

      if (!environment.initialized || !environment.healthy) {
        return {
          success: false,
          stack,
          environment,
          message:
            "Runtime environment was created but did not pass health checks.",
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
