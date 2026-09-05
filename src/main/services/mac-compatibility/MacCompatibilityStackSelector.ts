import type {
  MacArchitecture,
  MacCompatibilityComponent,
  MacCompatibilityStack,
  MacCompatibilityRuntimeFamily,
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
 * Capability-driven stack ranking. Runtime presence is not sufficient: a
 * graphics backend must also advertise the required API and be compatible
 * with the selected runtime family when that coupling is known.
 */
export class MacCompatibilityStackSelector {
  select(input: MacCompatibilityStackSelectionInput): MacCompatibilityStackCandidate[] {
    const candidates: MacCompatibilityStackCandidate[] = [];
    const graphicsComponents = input.components.filter(
      (component) => component.type === "graphics" && component.isInstalled
    );

    for (const wine of input.wineVersions) {
      if (!this.supportsArchitecture(wine, input.systemInfo)) continue;

      const graphicsComponent = this.findGraphicsComponent(
        graphicsComponents,
        input.requirements?.graphicsApis ?? [],
        wine.runtimeFamily ?? "wine"
      );

      const stack: MacCompatibilityStack = {
        id: graphicsComponent
          ? `wine:${wine.id}+graphics:${graphicsComponent.id}`
          : `wine:${wine.id}`,
        runtimeComponentId: wine.id,
        runtimeFamily: wine.runtimeFamily ?? "wine",
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
        reasons.push("Runtime installation is marked as recommended.");
      }

      if (input.systemInfo.isAppleSilicon && wine.architecture === "arm64") {
        score += 10;
        reasons.push("Runtime architecture matches Apple Silicon.");
      }

      if (
        input.systemInfo.isAppleSilicon &&
        wine.architecture === "x64" &&
        input.systemInfo.rosettaAvailable
      ) {
        score += 6;
        reasons.push("Rosetta is available for the x86_64 runtime.");
      } else if (wine.architecture === "x64" && input.systemInfo.isAppleSilicon) {
        eligible = false;
        score = Math.min(score, 20);
        reasons.push("x86_64 runtime requires Rosetta on Apple Silicon, but Rosetta was not detected.");
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
            `Installed graphics backend supports ${input.requirements.graphicsApis.join(", ")} for the ${wine.runtimeFamily ?? "wine"} runtime family.`
          );
        } else {
          eligible = false;
          score = Math.min(score, 20);
          reasons.push(
            `No installed graphics backend currently advertises support for ${input.requirements.graphicsApis.join(", ")} with the ${wine.runtimeFamily ?? "wine"} runtime family.`
          );
        }
      }

      candidates.push({ stack, score, eligible, reasons });
    }

    candidates.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.stack.id.localeCompare(b.stack.id);
    });

    return candidates;
  }

  private supportsArchitecture(
    runtime: MacWineVersion,
    systemInfo: MacSystemInfo
  ): boolean {
    const systemArchitecture = systemInfo.architecture;

    if (runtime.architecture === "universal") {
      return systemArchitecture !== "unknown";
    }

    if (systemArchitecture === "unknown") return false;

    if (runtime.architecture === systemArchitecture) return true;

    return (
      systemInfo.isAppleSilicon &&
      runtime.architecture === "x64" &&
      runtime.runtimeFamily === "apple-gptk" &&
      systemInfo.rosettaAvailable
    );
  }

  private findGraphicsComponent(
    components: MacCompatibilityComponent[],
    requiredApis: NonNullable<MacGameRequirements["graphicsApis"]>,
    runtimeFamily: MacCompatibilityRuntimeFamily
  ): MacCompatibilityComponent | null {
    if (requiredApis.length === 0) return null;

    return (
      components.find((component) => {
        if (
          component.runtimeFamily !== undefined &&
          component.runtimeFamily !== runtimeFamily
        ) {
          return false;
        }

        return requiredApis.every((api) =>
          component.supportedGraphicsApis?.includes(api)
        );
      }) ?? null
    );
  }

  private findToolingIds(components: MacCompatibilityComponent[]): string[] {
    return components
      .filter((component) => component.type === "tooling" && component.isInstalled)
      .map((component) => component.id)
      .sort();
  }
}
