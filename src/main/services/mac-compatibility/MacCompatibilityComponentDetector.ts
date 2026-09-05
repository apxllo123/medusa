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
  commands: Array<{ file: string; args: string[] }>;
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
    commands: [
      { file: "xcrun", args: ["--find", "metal"] },
    ],
    architectures: ["arm64", "x64"],
  },
  {
    id: "apple-gpucapture",
    name: "Apple Metal GPU capture",
    type: "tooling",
    commands: [
      { file: "xcrun", args: ["--find", "gpucapture"] },
    ],
    architectures: ["arm64", "x64"],
  },
  {
    id: "apple-gpudebug",
    name: "Apple Metal GPU debugger",
    type: "tooling",
    commands: [
      { file: "xcrun", args: ["--find", "gpudebug"] },
    ],
    architectures: ["arm64", "x64"],
  },
  {
    id: "apple-gptk",
    name: "Apple Game Porting Toolkit",
    type: "tooling",
    commands: [
      { file: "gameportingtoolkit", args: ["--help"] },
      { file: "game-porting-toolkit", args: ["--help"] },
    ],
    architectures: ["arm64"],
  },
];

export class MacCompatibilityComponentDetector {
  private readonly run: CompatibilityCommandRunner;

  constructor(commandRunner: CompatibilityCommandRunner = defaultCommandRunner) {
    this.run = commandRunner;
  }

  async discoverInstalledComponents(
    architecture: MacArchitecture
  ): Promise<MacCompatibilityComponent[]> {
    if (architecture === "unknown") {
      return [];
    }

    const components: MacCompatibilityComponent[] = [];

    for (const candidate of TOOL_CANDIDATES) {
      if (!candidate.architectures.includes(architecture)) {
        continue;
      }

      const executablePath = await this.findTool(candidate);

      if (!executablePath) {
        continue;
      }

      components.push({
        id: candidate.id,
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
   * Find a tool using the system resolver and return only an absolute,
   * existing executable path. A successful --help invocation is used as
   * an additional sanity check because `xcrun --find` may locate a shim
   * that is not usable in the current developer-tool configuration.
   */
  private async findTool(candidate: ToolCandidate): Promise<string | null> {
    for (const command of candidate.commands) {
      try {
        const output = await this.run("xcrun", ["--find", command.file]).catch(
          () => ""
        );

        const resolved = output
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.startsWith("/"));

        if (!resolved) {
          continue;
        }

        await access(resolved, constants.X_OK);

        try {
          await this.run(command.file, command.args);
        } catch {
          // A located Metal tool is still useful information even when a
          // harmless help/version probe is rejected by that tool.
        }

        return resolved;
      } catch {
        // Try the next representation of the same candidate.
      }
    }

    return null;
  }
}
