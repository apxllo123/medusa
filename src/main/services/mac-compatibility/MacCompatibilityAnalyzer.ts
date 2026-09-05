import type {
  MacCompatibilityGameKey,
  MacSystemInfo,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";
import { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.js";
import {
  MacCompatibilityStackSelector,
  type MacCompatibilityStackCandidate,
} from "./MacCompatibilityStackSelector.js";
import { MacSystemDetector } from "./MacSystemDetector.js";
import { MacWineDetector } from "./MacWineDetector.js";
import {
  getMacGameRequirements,
  type MacGameRequirements,
} from "./MacGameRequirementsCatalog.js";

export interface MacCompatibilityAnalysis {
  systemInfo: MacSystemInfo;
  wineVersions: MacWineVersion[];
  requirements: MacGameRequirements | null;
  candidates: MacCompatibilityStackCandidate[];
  preferredStackId: string | null;
}

export interface MacCompatibilityAnalyzerDependencies {
  systemDetector?: MacSystemDetector;
  wineDetector?: MacWineDetector;
  registry?: MacCompatibilityRegistry;
  selector?: MacCompatibilityStackSelector;
}

/**
 * Single read-only analysis pass used by future provisioning, launch, and
 * recovery orchestration. It does not mutate the game or filesystem.
 */
export class MacCompatibilityAnalyzer {
  private readonly systemDetector: MacSystemDetector;
  private readonly wineDetector: MacWineDetector;
  private readonly registry: MacCompatibilityRegistry;
  private readonly selector: MacCompatibilityStackSelector;

  constructor(dependencies?: MacCompatibilityAnalyzerDependencies) {
    this.systemDetector =
      dependencies?.systemDetector ?? new MacSystemDetector();
    this.wineDetector =
      dependencies?.wineDetector ?? new MacWineDetector();
    this.registry = dependencies?.registry ?? new MacCompatibilityRegistry();
    this.selector =
      dependencies?.selector ?? new MacCompatibilityStackSelector();
  }

  async analyze(
    game: MacCompatibilityGameKey
  ): Promise<MacCompatibilityAnalysis> {
    const systemInfo = await this.systemDetector.detect();
    const wineVersions = await this.wineDetector.detectInstalledVersions();
    const requirements = getMacGameRequirements(game.shop, game.objectId);
    const preferredStackId = this.registry.getSelectedStackId(game);
    const candidates = this.selector.select({
      systemInfo,
      wineVersions,
      components: systemInfo.compatibilityComponents ?? [],
      preferredStackId,
      requirements,
    });

    return {
      systemInfo,
      wineVersions,
      requirements,
      candidates,
      preferredStackId,
    };
  }
}
