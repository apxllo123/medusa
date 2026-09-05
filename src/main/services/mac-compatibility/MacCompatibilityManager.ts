import type {
  MacCompatibilityCheckResult,
  MacCompatibilityGameKey,
  MacGameCompatibility,
  MacSystemInfo,
  MacWineEnvironment,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";
import { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.js";
import { MacSystemDetector } from "./MacSystemDetector.js";
import { MacWineDetector } from "./MacWineDetector.js";
import {
  MacCompatibilityStackSelector,
  type MacCompatibilityStackCandidate,
} from "./MacCompatibilityStackSelector.js";
import { getMacGameRequirements } from "./MacGameRequirementsCatalog.js";
import {
  MacWineEnvironmentManager,
  MacWineEnvironmentRepairer,
} from "./environment/index.js";

export interface MacCompatibilityManagerDependencies {
  systemDetector?: MacSystemDetector;
  wineDetector?: MacWineDetector;
  registry?: MacCompatibilityRegistry;
  environmentManager?: MacWineEnvironmentManager;
  environmentRepairer?: MacWineEnvironmentRepairer;
  stackSelector?: MacCompatibilityStackSelector;
}

export class MacCompatibilityManager {
  private readonly systemDetector: MacSystemDetector;
  private readonly wineDetector: MacWineDetector;
  private readonly registry: MacCompatibilityRegistry;
  private readonly environmentManager: MacWineEnvironmentManager;
  private readonly environmentRepairer: MacWineEnvironmentRepairer;
  private readonly stackSelector: MacCompatibilityStackSelector;

  constructor(dependencies?: MacCompatibilityManagerDependencies) {
    this.systemDetector = dependencies?.systemDetector ?? new MacSystemDetector();
    this.wineDetector = dependencies?.wineDetector ?? new MacWineDetector();
    this.registry = dependencies?.registry ?? new MacCompatibilityRegistry();
    this.environmentManager =
      dependencies?.environmentManager ?? new MacWineEnvironmentManager();
    this.environmentRepairer =
      dependencies?.environmentRepairer ?? new MacWineEnvironmentRepairer();
    this.stackSelector =
      dependencies?.stackSelector ?? new MacCompatibilityStackSelector();
  }

  async getSystemInfo(): Promise<MacSystemInfo> {
    return this.systemDetector.detect();
  }

  async getWineVersions(): Promise<MacWineVersion[]> {
    return this.wineDetector.detectInstalledVersions();
  }

  async isWineAvailable(): Promise<boolean> {
    return this.wineDetector.isWineAvailable();
  }

  async getGameEnvironment(
    game: MacCompatibilityGameKey
  ): Promise<MacWineEnvironment | null> {
    return this.environmentManager.getEnvironment(game);
  }

  async selectCompatibilityStacks(
    game: MacCompatibilityGameKey
  ): Promise<MacCompatibilityStackCandidate[]> {
    const systemInfo = await this.getSystemInfo();
    const wineVersions = await this.getWineVersions();
    const preferredStackId = this.registry.get(game)?.selectedStack?.id ?? null;
    const requirements = getMacGameRequirements(game.shop, game.objectId);

    return this.stackSelector.select({
      systemInfo,
      wineVersions,
      components: systemInfo.compatibilityComponents ?? [],
      preferredStackId,
      requirements,
    });
  }

  async checkGame(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean
  ): Promise<MacGameCompatibility> {
    const systemInfo = await this.getSystemInfo();
    const wineVersions = await this.getWineVersions();
    const requirements = getMacGameRequirements(game.shop, game.objectId);
    const stackCandidates = isWindowsGame
      ? this.stackSelector.select({
          systemInfo,
          wineVersions,
          components: systemInfo.compatibilityComponents ?? [],
          preferredStackId: this.registry.get(game)?.selectedStack?.id ?? null,
          requirements,
        })
      : [];
    const selectedStack = stackCandidates.find((candidate) => candidate.eligible)?.stack ?? null;

    const issues: MacGameCompatibility["issues"] = [];
    const recommendations: MacGameCompatibility["recommendations"] = [];

    if (!isWindowsGame) {
      const result: MacGameCompatibility = {
        shop: game.shop,
        objectId: game.objectId,
        title,
        status: "ready",
        level: "native",
        score: 100,
        isWindowsGame: false,
        requiresWine: false,
        requiresRosetta: false,
        recommendedWineVersionId: null,
        recommendedWineVersionName: null,
        environment: null,
        compatibilityStack: null,
        issues,
        recommendations,
      };

      this.registry.setStatus(game, result.status);
      return result;
    }

    const environment =
      await this.environmentManager.refreshEnvironmentPresence(game);

    const recommendedWine =
      wineVersions.find((wine) => wine.isRecommended) ?? wineVersions[0];

    if (!recommendedWine) {
      issues.push({
        id: "wine-not-installed",
        code: "WINE_NOT_INSTALLED",
        title: "Wine is not installed",
        description:
          "A Windows compatibility environment is required to run this game on macOS.",
        severity: "error",
        fixable: true,
        action: "create-environment",
      });

      recommendations.push({
        id: "install-wine",
        title: "Set up a Windows runtime",
        description:
          "Install or configure a compatible Windows runtime before launching this game.",
        action: "create-environment",
        priority: "high",
      });
    } else if (!environment) {
      recommendations.push({
        id: "create-game-environment",
        title: "Create a game environment",
        description: "Create a dedicated compatibility environment for this game.",
        action: "create-environment",
        priority: "high",
      });
    }

    if (requirements?.graphicsApis.length && !selectedStack) {
      issues.push({
        id: "graphics-backend-missing",
        code: "GRAPHICS_BACKEND_MISSING",
        title: "Required graphics backend is not available",
        description:
          `This title requires ${requirements.graphicsApis.join(", ")}, but no currently discovered compatible graphics backend can satisfy that requirement.`,
        severity: "error",
        fixable: true,
        action: "install-component",
      });

      recommendations.push({
        id: "install-graphics-backend",
        title: "Set up a compatible graphics backend",
        description:
          `Medusa needs a verified ${requirements.graphicsApis.join(", ")} translation backend for this game.`,
        action: "install-component",
        priority: "high",
      });
    } else if (stackCandidates.length === 0 && recommendedWine) {
      recommendations.push({
        id: "no-compatible-stack",
        title: "No compatible runtime stack is currently available",
        description:
          "Medusa found a Windows runtime, but it does not currently match the host capabilities and game requirements.",
        action: "change-wine",
        priority: "high",
      });
    }

    if (environment && !environment.healthy) {
      issues.push({
        id: "environment-unhealthy",
        code: "ENVIRONMENT_UNHEALTHY",
        title: "Environment needs repair",
        description:
          "The compatibility environment exists but is not currently healthy.",
        severity: "error",
        fixable: true,
        action: "repair",
      });

      recommendations.push({
        id: "repair-environment",
        title: "Repair the compatibility environment",
        description:
          "Reinitialize the game's environment and test it again.",
        action: "repair",
        priority: "high",
      });
    }

    let status: MacGameCompatibility["status"] = "needs_setup";
    let level: MacGameCompatibility["level"] = "poor";
    let score = selectedStack?.confidence ?? null;

    if (environment?.healthy && (!requirements?.graphicsApis.length || selectedStack)) {
      status = "ready";
      level = "good";
      score = Math.max(score ?? 0, 85);
    } else if (environment && !environment.healthy) {
      status = "needs_repair";
      level = "poor";
      score = selectedStack ? Math.max(stackCandidates.find((candidate) => candidate.stack.id === selectedStack.id)?.score ?? 0, 40) : 25;
    } else if (selectedStack) {
      level = "good";
      score = stackCandidates.find((candidate) => candidate.stack.id === selectedStack.id)?.score ?? null;
    }

    const result: MacGameCompatibility = {
      shop: game.shop,
      objectId: game.objectId,
      title,
      status,
      level,
      score,
      isWindowsGame: true,
      requiresWine: true,
      requiresRosetta: systemInfo.isAppleSilicon,
      recommendedWineVersionId: recommendedWine?.id ?? null,
      recommendedWineVersionName: recommendedWine?.name ?? null,
      environment,
      compatibilityStack: selectedStack,
      issues,
      recommendations,
    };

    this.registry.setStatus(game, result.status);

    if (recommendedWine) this.registry.setWineVersion(game, recommendedWine.id);

    if (selectedStack) this.registry.setSelectedStack(game, selectedStack);

    return result;
  }

  async checkGameStatus(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean
  ): Promise<MacCompatibilityCheckResult> {
    const result = await this.checkGame(game, title, isWindowsGame);

    return {
      status: result.status,
      issues: result.issues,
      recommendations: result.recommendations,
      checkedAt: new Date().toISOString(),
    };
  }

  async createGameEnvironment(
    game: MacCompatibilityGameKey
  ): Promise<MacWineEnvironment> {
    const wineVersions = await this.getWineVersions();
    const wineVersion =
      wineVersions.find((wine) => wine.isRecommended) ?? wineVersions[0];

    if (!wineVersion) {
      throw new Error("No compatible Windows runtime is installed.");
    }

    const environment = await this.environmentManager.createEnvironment(
      game,
      wineVersion
    );

    this.registry.setEnvironment(game, environment);
    this.registry.setWineVersion(game, wineVersion.id);
    this.registry.setStatus(game, environment.healthy ? "ready" : "needs_repair");

    return environment;
  }

  async testGameEnvironment(game: MacCompatibilityGameKey): Promise<boolean> {
    const environment = await this.getGameEnvironment(game);
    if (!environment) {
      this.registry.setStatus(game, "needs_setup");
      return false;
    }

    const wineVersions = await this.getWineVersions();
    const wineVersion = wineVersions.find((wine) => wine.id === environment.wineVersionId);

    if (!wineVersion) {
      this.registry.setStatus(game, "needs_repair");
      return false;
    }

    const { environment: checkedEnvironment, health } =
      await this.environmentManager.checkEnvironmentHealth(game, wineVersion);

    if (checkedEnvironment) this.registry.setEnvironment(game, checkedEnvironment);
    this.registry.setStatus(game, health.healthy ? "ready" : "needs_repair");
    return health.healthy;
  }

  async repairGameEnvironment(
    game: MacCompatibilityGameKey
  ): Promise<MacWineEnvironment> {
    const environment = await this.getGameEnvironment(game);
    if (!environment) throw new Error("No compatibility environment exists for this game.");

    const wineVersions = await this.getWineVersions();
    const wineVersion = wineVersions.find((wine) => wine.id === environment.wineVersionId);

    if (!wineVersion) {
      throw new Error("The runtime used by this environment is no longer installed.");
    }

    const result = await this.environmentRepairer.repair(
      environment,
      wineVersion.executablePath
    );

    if (!result.success) {
      this.registry.setStatus(game, "needs_repair");
      throw new Error(result.message);
    }

    const { environment: repairedEnvironment, health } =
      await this.environmentManager.checkEnvironmentHealth(game, wineVersion);
    const finalEnvironment = repairedEnvironment ?? result.environment;

    if (!health.healthy) {
      this.registry.setEnvironment(game, finalEnvironment);
      this.registry.setStatus(game, "needs_repair");
      throw new Error(health.message);
    }

    this.registry.setEnvironment(game, finalEnvironment);
    this.registry.setWineVersion(game, wineVersion.id);
    this.registry.setStatus(game, "ready");
    return finalEnvironment;
  }

  async deleteGameEnvironment(game: MacCompatibilityGameKey): Promise<boolean> {
    const deleted = await this.environmentManager.deleteEnvironment(game);
    if (deleted) {
      this.registry.setEnvironment(game, null);
      this.registry.setStatus(game, "needs_setup");
    }
    return deleted;
  }

  getRegistry(): MacCompatibilityRegistry { return this.registry; }
  getEnvironmentManager(): MacWineEnvironmentManager { return this.environmentManager; }
  getEnvironmentRepairer(): MacWineEnvironmentRepairer { return this.environmentRepairer; }
}
