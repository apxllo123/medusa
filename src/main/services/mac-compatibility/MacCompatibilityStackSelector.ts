import type {
  MacArchitecture,
  MacCompatibilityComponent,
  MacCompatibilityStack,
  MacSystemInfo,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";
import type { MacGameRequirements } from "./MacGameRequirementsCatalog.js";

export interface MacCompatibilityStackCandidate {
  stack: MacCompatibilityStack;
  score: number;
  eligible: boolean;
  reasons: string[];
}

export interface MacCompatibilityStackSelectionInput {
  systemInfo: MacSystemInfo;
  wineVersions: MacWineVersion[];
  components: MacCompatibilityComponent[];
  preferredStackId?: string | null;
  requirements?: MacGameRequirements | null;
}

/**
 * Capability-driven stack ranking. Runtime presence is not treated as
 * sufficient: when a game requires a graphics API, at least one installed
 * graphics translator must advertise support for that API before the
 * candidate is eligible for an actual compatibility experiment.
 */
export class MacCompatibilityStackSelector {
  select(input: MacCompatibilityStackSelectionInput): MacCompatibilityStackCandidate[] {
    const candidates: MacCompatibilityStackCandidate[] = [];
    const graphicsComponents = input.components.filter(
      (component) => component.type === "graphics" && component.isInstalled
    );

    for (const wine of input.wineVersions) {
      if (!this.supportsArchitecture(wine.architecture, input.systemInfo.architecture)) {
        continue;
      }

      const graphicsComponent = this.findGraphicsComponent(
        graphicsComponents,
        input.requirements?.graphicsApis ?? []
      );

      const stack: MacCompatibilityStack = {
        id: graphicsComponent
          ? `wine:${wine.id}+graphics:${graphicsComponent.id}`
          : `wine:${wine.id}`,
        runtimeComponentId: wine.id,
        graphicsComponentId: graphicsComponent?.id ?? null,
        toolingComponentIds: this.findToolingIds(input.components),
        dependencyComponentIds: [],
        confidence: null,
        verified: false,
      };

      let score = 50;
      let eligible = true;
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

      if (input.requirements?.graphicsApis.length) {
        if (graphicsComponent) {
          score += 20;
          reasons.push(
            `Installed graphics backend supports ${input.requirements.graphicsApis.join(", ")}.`
          );
        } else {
          eligible = false;
          score = Math.min(score, 20);
          reasons.push(
            `No installed graphics backend currently advertises support for ${input.requirements.graphicsApis.join(", ")}.`
          );
        }
      }

      candidates.push({ stack, score, eligible, reasons });
    }

    candidates.sort((a, b) => {
      if (a.eligible !== b.eligible) {
        return a.eligible ? -1 : 1;
      }

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

  private findGraphicsComponent(
    components: MacCompatibilityComponent[],
    requiredApis: NonNullable<MacGameRequirements["graphicsApis"]>
  ): MacCompatibilityComponent | null {
    if (requiredApis.length === 0) {
      return null;
    }

    return (
      components.find((component) =>
        requiredApis.every((api) =>
          component.supportedGraphicsApis?.includes(api)
        )
      ) ?? null
    );
  }

  private findToolingIds(components: MacCompatibilityComponent[]): string[] {
    return components
      .filter((component) => component.type === "tooling" && component.isInstalled)
      .map((component) => component.id)
      .sort();
  }
}
