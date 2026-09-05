import type {
  MacArchitecture,
  MacCompatibilityComponent,
  MacCompatibilityStack,
  MacSystemInfo,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";

export interface MacCompatibilityStackCandidate {
  stack: MacCompatibilityStack;
  score: number;
  reasons: string[];
}

export interface MacCompatibilityStackSelectionInput {
  systemInfo: MacSystemInfo;
  wineVersions: MacWineVersion[];
  components: MacCompatibilityComponent[];
  preferredStackId?: string | null;
}

/**
 * Capability-driven stack ranking. This first implementation deliberately
 * prefers verified, locally available components and keeps Wine as the
 * baseline runtime so existing installations remain usable while the
 * graphics/backend implementations are introduced incrementally.
 *
 * It does not claim that the presence of Apple tooling proves a game can
 * run. Actual compatibility is established later by an isolated probe.
 */
export class MacCompatibilityStackSelector {
  select(
    input: MacCompatibilityStackSelectionInput
  ): MacCompatibilityStackCandidate[] {
    const candidates: MacCompatibilityStackCandidate[] = [];

    for (const wine of input.wineVersions) {
      if (!this.supportsArchitecture(wine.architecture, input.systemInfo.architecture)) {
        continue;
      }

      const stack: MacCompatibilityStack = {
        id: `wine:${wine.id}`,
        runtimeComponentId: wine.id,
        graphicsComponentId: null,
        toolingComponentIds: this.findToolingIds(input.components),
        dependencyComponentIds: [],
        confidence: null,
        verified: false,
      };

      let score = 50;
      const reasons: string[] = ["Wine runtime is installed and discoverable."];

      if (wine.isRecommended) {
        score += 15;
        reasons.push("Wine installation is marked as recommended.");
      }

      if (input.systemInfo.isAppleSilicon && wine.architecture === "arm64") {
        score += 10;
        reasons.push("Runtime architecture matches Apple Silicon.");
      }

      if (input.systemInfo.rosettaAvailable && wine.architecture === "x64") {
        score += 3;
        reasons.push("Rosetta is available for Intel runtime support.");
      }

      if (input.preferredStackId === stack.id) {
        score += 20;
        reasons.push("Stack matches the stored preferred stack.");
      }

      if (stack.toolingComponentIds.length > 0) {
        score += 2;
        reasons.push("Apple developer/diagnostic tooling is available.");
      }

      candidates.push({
        stack,
        score,
        reasons,
      });
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.stack.id.localeCompare(b.stack.id);
    });

    return candidates;
  }

  private supportsArchitecture(
    runtimeArchitecture: MacArchitecture | "universal",
    systemArchitecture: MacArchitecture
  ): boolean {
    if (runtimeArchitecture === "universal") {
      return systemArchitecture !== "unknown";
    }

    if (systemArchitecture === "unknown") {
      return false;
    }

    return runtimeArchitecture === systemArchitecture;
  }

  private findToolingIds(
    components: MacCompatibilityComponent[]
  ): string[] {
    return components
      .filter((component) => component.type === "tooling" && component.isInstalled)
      .map((component) => component.id)
      .sort();
  }
}
