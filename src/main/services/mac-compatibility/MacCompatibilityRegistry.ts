import { readFileSync, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  MacCompatibilityExperiment,
  MacCompatibilityGameKey,
  MacCompatibilityLastKnownGood,
  MacCompatibilityRegistryEntry,
  MacCompatibilityStack,
  MacCompatibilityStatus,
  MacWineEnvironment,
} from "./MacCompatibilityTypes.js";

export class MacCompatibilityRegistry {
  private readonly entries = new Map<string, MacCompatibilityRegistryEntry>();
  private readonly registryPath: string;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    registryPath: string = join(
      homedir(),
      "Library",
      "Application Support",
      "Hydra",
      "mac-compatibility",
      "registry.json"
    )
  ) {
    this.registryPath = registryPath;
    this.loadFromDisk();
  }

  private getKey(key: MacCompatibilityGameKey): string {
    return `${key.shop}:${key.objectId}`;
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.registryPath)) return;

      const contents = readFileSync(this.registryPath, "utf8");
      const data = JSON.parse(contents) as MacCompatibilityRegistryEntry[];
      if (!Array.isArray(data)) return;

      for (const entry of data) {
        if (entry?.key?.shop && entry?.key?.objectId) {
          this.entries.set(this.getKey(entry.key), entry);
        }
      }
    } catch {
      // Corrupt or absent state starts empty and is recreated on write.
    }
  }

  private persist(): void {
    const contents = JSON.stringify(Array.from(this.entries.values()), null, 2);

    this.persistQueue = this.persistQueue.then(
      () => this.writeAtomically(contents),
      () => this.writeAtomically(contents)
    );

    this.persistQueue = this.persistQueue.catch((error) => {
      console.error(
        "[MacCompatibilityRegistry] Failed to persist registry:",
        error
      );
    });
  }

  private async writeAtomically(contents: string): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true });
    const temporaryPath = `${this.registryPath}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, contents, "utf8");
      await rename(temporaryPath, this.registryPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  public async flush(): Promise<void> {
    await this.persistQueue;
  }

  public get(key: MacCompatibilityGameKey): MacCompatibilityRegistryEntry | null {
    return this.entries.get(this.getKey(key)) ?? null;
  }

  public set(
    key: MacCompatibilityGameKey,
    entry: MacCompatibilityRegistryEntry
  ): void {
    this.entries.set(this.getKey(key), entry);
    this.persist();
  }

  public delete(key: MacCompatibilityGameKey): boolean {
    const deleted = this.entries.delete(this.getKey(key));
    if (deleted) this.persist();
    return deleted;
  }

  public has(key: MacCompatibilityGameKey): boolean {
    return this.entries.has(this.getKey(key));
  }

  public getEnvironment(key: MacCompatibilityGameKey): MacWineEnvironment | null {
    return this.get(key)?.environment ?? null;
  }

  public setEnvironment(
    key: MacCompatibilityGameKey,
    environment: MacWineEnvironment | null
  ): void {
    const existing = this.get(key);

    if (existing) {
      this.set(key, {
        ...existing,
        environment,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    this.set(key, {
      key,
      environment,
      selectedWineVersionId: environment?.wineVersionId ?? null,
      selectedStack: null,
      lastKnownGood: null,
      experiments: [],
      lastStatus: "unknown",
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    });
  }

  public setStatus(
    key: MacCompatibilityGameKey,
    status: MacCompatibilityStatus
  ): void {
    const existing = this.get(key);

    if (existing) {
      this.set(key, {
        ...existing,
        lastStatus: status,
        lastCheckedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    this.set(key, {
      key,
      environment: null,
      selectedWineVersionId: null,
      selectedStack: null,
      lastKnownGood: null,
      experiments: [],
      lastStatus: status,
      lastCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  public setWineVersion(
    key: MacCompatibilityGameKey,
    wineVersionId: string | null
  ): void {
    const existing = this.get(key);

    if (existing) {
      this.set(key, {
        ...existing,
        selectedWineVersionId: wineVersionId,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    this.set(key, {
      key,
      environment: null,
      selectedWineVersionId: wineVersionId,
      selectedStack: null,
      lastKnownGood: null,
      experiments: [],
      lastStatus: "unknown",
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    });
  }

  public getSelectedStackId(key: MacCompatibilityGameKey): string | null {
    return this.get(key)?.selectedStack?.id ?? null;
  }

  public setSelectedStack(
    key: MacCompatibilityGameKey,
    stack: MacCompatibilityStack | null
  ): void {
    const existing = this.get(key);

    if (existing) {
      this.set(key, {
        ...existing,
        selectedStack: stack,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    this.set(key, {
      key,
      environment: null,
      selectedWineVersionId: stack?.runtimeComponentId ?? null,
      selectedStack: stack,
      lastKnownGood: null,
      experiments: [],
      lastStatus: "unknown",
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    });
  }

  public getExperiments(key: MacCompatibilityGameKey): MacCompatibilityExperiment[] {
    return [...(this.get(key)?.experiments ?? [])];
  }

  public addExperiment(
    key: MacCompatibilityGameKey,
    experiment: MacCompatibilityExperiment
  ): void {
    const existing = this.get(key);

    if (existing) {
      this.set(key, {
        ...existing,
        experiments: [...(existing.experiments ?? []), experiment],
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    this.set(key, {
      key,
      environment: null,
      selectedWineVersionId: experiment.stack.runtimeComponentId,
      selectedStack: null,
      lastKnownGood: null,
      experiments: [experiment],
      lastStatus: "unknown",
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    });
  }

  public updateExperiment(
    key: MacCompatibilityGameKey,
    experimentId: string,
    update: Partial<MacCompatibilityExperiment>
  ): void {
    const existing = this.get(key);
    if (!existing) return;

    const experiments = (existing.experiments ?? []).map((experiment) =>
      experiment.id === experimentId ? { ...experiment, ...update } : experiment
    );

    this.set(key, {
      ...existing,
      experiments,
      updatedAt: new Date().toISOString(),
    });
  }

  public setLastKnownGood(
    key: MacCompatibilityGameKey,
    lastKnownGood: MacCompatibilityLastKnownGood
  ): void {
    const existing = this.get(key);
    if (!existing) {
      this.set(key, {
        key,
        environment: null,
        selectedWineVersionId: lastKnownGood.stack.runtimeComponentId,
        selectedStack: lastKnownGood.stack,
        lastKnownGood,
        experiments: [],
        lastStatus: "ready",
        lastCheckedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    this.set(key, {
      ...existing,
      selectedStack: lastKnownGood.stack,
      selectedWineVersionId: lastKnownGood.stack.runtimeComponentId,
      lastKnownGood,
      updatedAt: new Date().toISOString(),
    });
  }

  public getLastKnownGood(
    key: MacCompatibilityGameKey
  ): MacCompatibilityLastKnownGood | null {
    return this.get(key)?.lastKnownGood ?? null;
  }

  public getAll(): MacCompatibilityRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  public clear(): void {
    this.entries.clear();
    this.persist();
  }
}
