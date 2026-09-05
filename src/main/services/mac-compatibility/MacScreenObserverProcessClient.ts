import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import type {
  MacScreenObservationResult,
  MacScreenObserver,
} from "./MacScreenObservationTypes.js";

const execFileAsync = promisify(execFile);
const OBSERVER_TIMEOUT_MS = 15_000;

interface ProcessObserverOptions {
  helperPath?: string;
}

/**
 * Node-side bridge to the native Swift screen observer. It deliberately
 * treats native capture as optional: the compatibility system keeps working
 * when Screen Recording permission is unavailable or the helper is not yet
 * packaged on a development machine.
 */
export class MacScreenObserverProcessClient implements MacScreenObserver {
  private readonly helperPath?: string;

  constructor(options?: ProcessObserverOptions) {
    this.helperPath = options?.helperPath ?? this.resolveDefaultHelperPath();
  }

  async captureWindow(windowId?: number): Promise<MacScreenObservationResult> {
    return this.run(windowId);
  }

  async captureFocusedGameWindow(): Promise<MacScreenObservationResult> {
    return this.run();
  }

  private async run(windowId?: number): Promise<MacScreenObservationResult> {
    if (!this.helperPath || !(await this.isExecutable(this.helperPath))) {
      return this.unavailable("Native Mac screen observer is not installed.");
    }

    const args = windowId === undefined ? [] : ["--window-id", String(windowId)];

    try {
      const { stdout } = await execFileAsync(this.helperPath, args, {
        timeout: OBSERVER_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      });

      const parsed = JSON.parse(stdout) as MacScreenObservationResult;
      if (!parsed || typeof parsed !== "object") {
        return this.unavailable("Native screen observer returned invalid data.");
      }

      return parsed;
    } catch (error) {
      return this.unavailable(
        error instanceof Error
          ? error.message
          : "Native screen observer failed."
      );
    }
  }

  private async isExecutable(path: string): Promise<boolean> {
    try {
      await access(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private resolveDefaultHelperPath(): string | undefined {
    if (process.platform !== "darwin") {
      return undefined;
    }

    const candidates = [
      join(process.resourcesPath ?? "", "mac-screen-observer"),
      join(process.cwd(), "src", "main", "native", "mac-screen-observer"),
      join(
        process.cwd(),
        "out",
        "main",
        "native",
        "mac-screen-observer"
      ),
    ];

    return candidates.find((candidate) => candidate.length > 0);
  }

  private unavailable(error: string): MacScreenObservationResult {
    return {
      captured: false,
      source: "none",
      windowId: null,
      imagePath: null,
      observations: [],
      combinedText: "",
      error,
    };
  }
}
