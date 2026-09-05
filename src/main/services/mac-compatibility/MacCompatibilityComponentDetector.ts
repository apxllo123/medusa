import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import type {
  MacArchitecture,
  MacCompatibilityComponent,
} from "./MacCompatibilityTypes.js";

const execFileAsync = promisify(execFile);

/**
 * Component discovery must never block game launch indefinitely. These
 * probes are intentionally small and only establish that a tool is
 * actually callable; they do not claim that a backend can run a game.
 */
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

/**
 * Only tools that can be positively located are reported. In particular,
 * D3DMetal and DXMT are not inferred from generic DLL names: Wine prefixes
 * commonly contain d3d11/dxgi files even when those files are not provided
 * by either backend. Backend-specific artifact detection will be added
 * once Medusa owns a precise installation layout for those components.
 */
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
    if (architecture === "unknown") {
      return [];
    }

    const components: MacCompatibilityComponent[] = [];
    const seenIds = new Set<string>();

    for (const candidate of TOOL_CANDIDATES) {
      if (!candidate.architectures.includes(architecture)) {
        continue;
      }

      const executablePath = await this.findTool(candidate);

      if (!executablePath) {
        continue;
      }

      const componentId =
        candidate.id === "apple-gptk-hyphenated"
          ? "apple-gptk"
          : candidate.id;

      if (seenIds.has(componentId)) {
        continue;
      }

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

    return components;
  }

  /**
   * Resolve through the appropriate system resolver and return only an
   * absolute, executable path. A failed probe never creates a component;
   * a successful location is enough to record availability because some
   * developer tools reject --help/version in specialized environments.
   */
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

      if (!resolved) {
        return null;
      }

      await access(resolved, constants.X_OK);

      // Run the resolved executable, not the lookup command's name, so
      // Finder-launched Electron processes do not depend on their PATH.
      // The probe is deliberately best-effort; location + executable bit
      // remain the availability signal.
      await this.run(resolved, candidate.probeArgs).catch(() => undefined);

      return resolved;
    } catch {
      return null;
    }
  }
}
