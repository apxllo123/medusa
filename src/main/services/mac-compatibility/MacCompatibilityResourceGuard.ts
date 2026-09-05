export interface MacCompatibilityResourceBudget {
  maxConcurrentExperiments: number;
  minimumFreeDiskBytes: number;
}

export const DEFAULT_MAC_COMPATIBILITY_RESOURCE_BUDGET: MacCompatibilityResourceBudget = {
  maxConcurrentExperiments: 1,
  minimumFreeDiskBytes: 8 * 1024 ** 3,
};

/**
 * Small in-process guard for expensive compatibility experiments. The first
 * implementation intentionally permits one experiment at a time so Wine/
 * translation-layer testing cannot multiply CPU, unified-memory, and SSD
 * pressure on the user's Mac.
 */
export class MacCompatibilityResourceGuard {
  private activeExperiments = 0;
  private readonly budget: MacCompatibilityResourceBudget;

  constructor(
    budget: MacCompatibilityResourceBudget =
      DEFAULT_MAC_COMPATIBILITY_RESOURCE_BUDGET
  ) {
    this.budget = budget;
  }

  get activeCount(): number {
    return this.activeExperiments;
  }

  canStart(availableDiskBytes: number): boolean {
    return (
      this.activeExperiments < this.budget.maxConcurrentExperiments &&
      availableDiskBytes >= this.budget.minimumFreeDiskBytes
    );
  }

  acquire(availableDiskBytes: number): () => void {
    if (!this.canStart(availableDiskBytes)) {
      throw new Error(
        "Compatibility experiment blocked by the resource safety budget."
      );
    }

    this.activeExperiments += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.activeExperiments = Math.max(0, this.activeExperiments - 1);
    };
  }
}
