import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  MacArchitecture,
  MacCompatibilityComponent,
  MacCompatibilityRuntimeFamily,
} from "./MacCompatibilityTypes.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5_000;

export type CompatibilityCommandRunner = (
  file: string,
  args: string[]
) => Promise<string>;

const defaultCommandRunner: CompatibilityCommandRunner = async (
  file,
  args
) => {
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout: COMMAND_TIMEOUT_MS,
  });
  return `${stdout}\n${stderr}`.trim();
};

interface ToolCandidate {
  id: string;
  name: string;
  type: "tooling";
  resolver: { file: string; args: string[] };
  probeArgs: string[];
  architectures: MacArchitecture[];
}

interface GraphicsArtifactCandidate {
  id: string;
  name: string;
  primaryPath: string;
  requiredPaths: string[];
  architectures: MacArchitecture[];
  runtimeFamily: MacCompatibilityRuntimeFamily;
  supportedGraphicsApis: NonNullable<MacCompatibilityComponent["supportedGraphicsApis"]>;
}

const TOOL_CANDIDATES: ToolCandidate[] = [
  {
    id: "apple-metal-compiler",
    name: "Apple Metal compiler",
    type: "tooling",
    resolver: { file: "xcrun", args: ["--find", "metal"] },
    probeArgs: ["--version"],
    architectures: ["arm64", "x64"],
  },
  {
    id: "apple-gpucapture",
    name: "Apple Metal GPU capture",
    type: "tooling",
    resolver: { file: "xcrun", args: ["--find", "gpucapture"] },
    probeArgs: ["--help"],
    architectures: ["arm64", "x64"],
  },
  {
    id: "apple-gpudebug",
    name: "Apple Metal GPU debugger",
    type: "tooling",
    resolver: { file: "xcrun", args: ["--find", "gpudebug"] },
    probeArgs: ["--help"],
    architectures: ["arm64", "x64"],
  },
  {
    id: "apple-gptk",
    name: "Apple Game Porting Toolkit",
    type: "tooling",
    resolver: { file: "which", args: ["gameportingtoolkit"] },
    probeArgs: ["--help"],
    architectures: ["arm64"],
  },
  {
    id: "apple-gptk-hyphenated",
    name: "Apple Game Porting Toolkit",
    type: "tooling",
    resolver: { file: "which", args: ["game-porting-toolkit"] },
    probeArgs: ["--help"],
    architectures: ["arm64"],
  },
];

const GPTK_APP_PATHS = [
  "/Applications/Game Porting Toolkit.app",
  join(homedir(), "Applications", "Game Porting Toolkit.app"),
  join(homedir(), "Downloads", "Game Porting Toolkit.app"),
];

const CROSSOVER_ROOT =
  "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver";

function createGraphicsCandidates(): GraphicsArtifactCandidate[] {
  const candidates: GraphicsArtifactCandidate[] = [];

  for (const appPath of GPTK_APP_PATHS) {
    const externalPath = join(
      appPath,
      "Contents",
      "Resources",
      "wine",
      "lib",
      "external"
    );

    candidates.push({
      id: "apple-d3dmetal",
      name: "Apple D3DMetal (Game Porting Toolkit)",
      primaryPath: join(
        externalPath,
        "D3DMetal.framework",
        "D3DMetal"
      ),
      requiredPaths: [join(externalPath, "libd3dshared.dylib")],
      architectures: ["arm64"],
      runtimeFamily: "apple-gptk",
      supportedGraphicsApis: ["d3d11", "d3d12"],
    });
  }

  const crossoverExternal = join(
    CROSSOVER_ROOT,
    "lib64",
    "apple_gptk",
    "external"
  );

  candidates.push({
    id: "crossover-d3dmetal",
    name: "CrossOver D3DMetal",
    primaryPath: join(
      crossoverExternal,
      "D3DMetal.framework",
      "D3DMetal"
    ),
    requiredPaths: [join(crossoverExternal, "libd3dshared.dylib")],
    architectures: ["arm64", "x64"],
    runtimeFamily: "crossover",
    supportedGraphicsApis: ["d3d11", "d3d12"],
  });

  return candidates;
}

export class MacCompatibilityComponentDetector {
  private readonly run: CompatibilityCommandRunner;

  constructor(
    commandRunner: CompatibilityCommandRunner = defaultCommandRunner
  ) {
    this.run = commandRunner;
  }

  async discoverInstalledComponents(
    architecture: MacArchitecture
  ): Promise<MacCompatibilityComponent[]> {
    if (architecture === "unknown") return [];

    const components: MacCompatibilityComponent[] = [];
    const seenIds = new Set<string>();

    for (const candidate of TOOL_CANDIDATES) {
      if (!candidate.architectures.includes(architecture)) continue;

      const executablePath = await this.findTool(candidate);
      if (!executablePath) continue;

      const componentId =
        candidate.id === "apple-gptk-hyphenated"
          ? "apple-gptk"
          : candidate.id;

      if (seenIds.has(componentId)) continue;
      seenIds.add(componentId);

      components.push({
        id: componentId,
        name: candidate.name,
        type: candidate.type,
        version: null,
        executablePath,
        isInstalled: true,
        architectures: candidate.architectures,
      });
    }

    for (const candidate of createGraphicsCandidates()) {
      if (!candidate.architectures.includes(architecture)) continue;
      if (seenIds.has(candidate.id)) continue;

      const present = await this.pathsExist(
        candidate.primaryPath,
        candidate.requiredPaths
      );

      if (!present) continue;

      seenIds.add(candidate.id);
      components.push({
        id: candidate.id,
        name: candidate.name,
        type: "graphics",
        version: null,
        executablePath: candidate.primaryPath,
        isInstalled: true,
        architectures: candidate.architectures,
        runtimeFamily: candidate.runtimeFamily,
        supportedGraphicsApis: candidate.supportedGraphicsApis,
      });
    }

    return components;
  }

  private async pathsExist(
    primaryPath: string,
    requiredPaths: string[]
  ): Promise<boolean> {
    try {
      await access(primaryPath, constants.F_OK);
      for (const requiredPath of requiredPaths) {
        await access(requiredPath, constants.F_OK);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async findTool(candidate: ToolCandidate): Promise<string | null> {
    try {
      const output = await this.run(
        candidate.resolver.file,
        candidate.resolver.args
      );

      const resolved = output
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("/"));

      if (!resolved) return null;

      await access(resolved, constants.X_OK);
      await this.run(resolved, candidate.probeArgs).catch(() => undefined);
      return resolved;
    } catch {
      return null;
    }
  }
}
