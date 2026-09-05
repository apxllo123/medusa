import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  MacArchitecture,
  MacCompatibilityRuntimeFamily,
  MacWineType,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";

const execFileAsync = promisify(execFile);

const VERSION_TIMEOUT_MS = 15_000;
const WHICH_TIMEOUT_MS = 5_000;

export interface WineCandidate {
  id: string;
  name: string;
  type: MacWineType;
  executablePath: string;
  architecture: MacArchitecture | "universal";
  runtimeFamily: MacCompatibilityRuntimeFamily;
}

const GPTK_WINE_LOCATIONS = [
  {
    id: "apple-gptk-wine-arm64",
    path: "/Applications/Game Porting Toolkit.app/Contents/Resources/wine/bin/wine64",
  },
  {
    id: "apple-gptk-wine-home-applications",
    path: join(
      homedir(),
      "Applications",
      "Game Porting Toolkit.app",
      "Contents",
      "Resources",
      "wine",
      "bin",
      "wine64"
    ),
  },
  {
    id: "apple-gptk-wine-downloads",
    path: join(
      homedir(),
      "Downloads",
      "Game Porting Toolkit.app",
      "Contents",
      "Resources",
      "wine",
      "bin",
      "wine64"
    ),
  },
];

/**
 * Only real Wine-compatible executables belong here. GPTK gets its own
 * runtime family because Apple's D3DMetal payload is coupled to the Wine
 * environment shipped with the toolkit.
 */
export const WINE_CANDIDATES: WineCandidate[] = [
  ...GPTK_WINE_LOCATIONS.map(({ id, path }) => ({
    id,
    name: "Game Porting Toolkit Wine",
    type: "wine" as const,
    executablePath: path,
    architecture: "x64" as const,
    runtimeFamily: "apple-gptk" as const,
  })),
  {
    id: "homebrew-wine-arm64",
    name: "Wine (Homebrew, Apple Silicon)",
    type: "wine",
    executablePath: "/opt/homebrew/bin/wine64",
    architecture: "arm64",
    runtimeFamily: "wine",
  },
  {
    id: "homebrew-wine-arm64-32",
    name: "Wine (Homebrew, Apple Silicon)",
    type: "wine",
    executablePath: "/opt/homebrew/bin/wine",
    architecture: "arm64",
    runtimeFamily: "wine",
  },
  {
    id: "homebrew-wine-intel",
    name: "Wine (Homebrew, Intel)",
    type: "wine",
    executablePath: "/usr/local/bin/wine64",
    architecture: "x64",
    runtimeFamily: "wine",
  },
  {
    id: "homebrew-wine-intel-32",
    name: "Wine (Homebrew, Intel)",
    type: "wine",
    executablePath: "/usr/local/bin/wine",
    architecture: "x64",
    runtimeFamily: "wine",
  },
  {
    id: "crossover",
    name: "CrossOver",
    type: "wine-crossover",
    executablePath:
      "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine",
    architecture: "universal",
    runtimeFamily: "crossover",
  },
  {
    id: "path-wine",
    name: "Wine (PATH)",
    type: "wine",
    executablePath: "wine",
    architecture: "unknown",
    runtimeFamily: "unknown",
  },
];

const WINE_VERSION_PATTERN = /wine|crossover/i;

export class MacWineDetector {
  private readonly candidates: WineCandidate[];

  constructor(candidates: WineCandidate[] = WINE_CANDIDATES) {
    this.candidates = candidates;
  }

  async detectInstalledVersions(): Promise<MacWineVersion[]> {
    const versions: MacWineVersion[] = [];
    const seenExecutablePaths = new Set<string>();

    for (const candidate of this.candidates) {
      const resolvedPath = await this.resolveExecutable(candidate.executablePath);
      if (!resolvedPath || seenExecutablePaths.has(resolvedPath)) continue;

      seenExecutablePaths.add(resolvedPath);
      const version = await this.getWineVersion(resolvedPath);
      if (!version) continue;

      versions.push({
        id: candidate.id,
        name: candidate.name,
        version,
        type: candidate.type,
        executablePath: resolvedPath,
        isInstalled: true,
        isRecommended: this.isRecommended(candidate.id),
        architecture: candidate.architecture,
        runtimeFamily: candidate.runtimeFamily,
      });
    }

    return versions;
  }

  async isWineAvailable(): Promise<boolean> {
    return (await this.detectInstalledVersions()).length > 0;
  }

  private async resolveExecutable(executablePath: string): Promise<string | null> {
    const absolutePath = executablePath.startsWith("/")
      ? executablePath
      : await this.resolveFromPath(executablePath);

    if (!absolutePath) return null;

    try {
      const stats = await stat(absolutePath);
      if (!stats.isFile()) return null;
      await access(absolutePath, constants.X_OK);
      return await realpath(absolutePath);
    } catch {
      return null;
    }
  }

  private async resolveFromPath(command: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("which", [command], {
        timeout: WHICH_TIMEOUT_MS,
      });
      const firstLine = stdout.trim().split("\n")[0]?.trim() ?? "";
      return firstLine.startsWith("/") ? firstLine : null;
    } catch {
      return null;
    }
  }

  private async getWineVersion(executablePath: string): Promise<string | null> {
    try {
      const { stdout, stderr } = await execFileAsync(
        executablePath,
        ["--version"],
        { timeout: VERSION_TIMEOUT_MS }
      );

      const output = `${stdout}\n${stderr}`.trim();
      const firstLine = output.split("\n")[0]?.trim() ?? "";
      return WINE_VERSION_PATTERN.test(firstLine) ? firstLine : null;
    } catch {
      return null;
    }
  }

  private isRecommended(id: string): boolean {
    return (
      id.startsWith("apple-gptk-wine") ||
      id === "homebrew-wine-arm64" ||
      id === "homebrew-wine-intel"
    );
  }
}
