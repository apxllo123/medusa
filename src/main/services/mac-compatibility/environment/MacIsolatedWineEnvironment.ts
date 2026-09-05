import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  MacCompatibilityGameKey,
  MacWineEnvironment,
  MacWineVersion,
} from "../MacCompatibilityTypes.js";
import {
  assertManagedExperimentPrefixPath,
  DEFAULT_MAC_EXPERIMENTS_PATH,
  createEnvironmentId,
} from "./MacWineEnvironmentPaths.js";
import { MacWineEnvironmentHealthChecker } from "./MacWineEnvironmentHealthChecker.js";

const execFileAsync = promisify(execFile);
const WINEBOOT_TIMEOUT_MS = 300_000;

export class MacIsolatedWineEnvironment {
  private readonly healthChecker = new MacWineEnvironmentHealthChecker();
  private readonly experimentsPath: string;

  constructor(experimentsPath = DEFAULT_MAC_EXPERIMENTS_PATH) {
    this.experimentsPath = experimentsPath;
  }

  async create(
    game: MacCompatibilityGameKey,
    wineVersion: MacWineVersion,
    prefixPath: string
  ): Promise<MacWineEnvironment> {
    const safePrefixPath = await assertManagedExperimentPrefixPath(
      this.experimentsPath,
      prefixPath
    );

    await mkdir(safePrefixPath, { recursive: true });

    await execFileAsync(wineVersion.executablePath, ["wineboot", "--init"], {
      timeout: WINEBOOT_TIMEOUT_MS,
      env: {
        ...process.env,
        WINEPREFIX: safePrefixPath,
        WINEDEBUG: "-all",
        WINEDLLOVERRIDES: "mscoree=d;mshtml=d",
      },
    });

    const health = await this.healthChecker.check(
      safePrefixPath,
      wineVersion.executablePath
    );

    return {
      id: `experiment-${createEnvironmentId(game)}`,
      prefixPath: safePrefixPath,
      wineVersionId: wineVersion.id,
      wineVersionName: wineVersion.name,
      architecture:
        wineVersion.architecture === "universal"
          ? "unknown"
          : wineVersion.architecture,
      exists: true,
      initialized: health.initialized,
      healthy: health.healthy,
      installedComponents: health.initialized ? ["wine-prefix"] : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
