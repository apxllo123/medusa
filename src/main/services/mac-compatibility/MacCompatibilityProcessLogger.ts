import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MacCompatibilityGameKey } from "./MacCompatibilityTypes.js";

export interface MacCompatibilityProcessLogHandle {
  stdoutFd: number;
  stderrFd: number;
  stdoutPath: string;
  stderrPath: string;
}

const DEFAULT_LOG_ROOT = join(
  homedir(),
  "Library",
  "Application Support",
  "Hydra",
  "mac-compatibility",
  "logs"
);

/**
 * File-backed logging for detached Windows-game processes. Pipes are avoided
 * deliberately: a detached game can outlive the Electron request, whereas
 * these files remain readable by the later observation/diagnostic pass.
 */
export class MacCompatibilityProcessLogger {
  private readonly root: string;

  constructor(root = DEFAULT_LOG_ROOT) {
    this.root = root;
  }

  open(game: MacCompatibilityGameKey, runId: string): MacCompatibilityProcessLogHandle {
    const directory = join(this.root, game.shop, game.objectId);
    mkdirSync(directory, { recursive: true });

    const stdoutPath = join(directory, `${runId}.stdout.log`);
    const stderrPath = join(directory, `${runId}.stderr.log`);
    const stdoutFd = openSync(stdoutPath, "a");
    const stderrFd = openSync(stderrPath, "a");

    return { stdoutFd, stderrFd, stdoutPath, stderrPath };
  }

  close(handle: MacCompatibilityProcessLogHandle): void {
    try {
      closeSync(handle.stdoutFd);
    } catch {
      // Already closed by the process/runtime.
    }
    try {
      closeSync(handle.stderrFd);
    } catch {
      // Already closed by the process/runtime.
    }
  }

  read(path: string, maxBytes = 256 * 1024): string {
    if (!existsSync(path)) return "";

    try {
      const contents = readFileSync(path, "utf8");
      return contents.length > maxBytes
        ? contents.slice(-maxBytes)
        : contents;
    } catch {
      return "";
    }
  }
}
