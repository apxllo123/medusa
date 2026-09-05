import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import type {
  MacCompatibilityGameKey,
  MacCompatibilityStack,
  MacGameCompatibility,
  MacWineEnvironment,
  MacWineVersion,
} from "../MacCompatibilityTypes.js";
import { MacCompatibilityManager } from "../MacCompatibilityManager.js";
import {
  MacCompatibilityProcessLogger,
  type MacCompatibilityProcessLogHandle,
} from "../MacCompatibilityProcessLogger.js";

export interface MacGameLaunchRequest {
  game: MacCompatibilityGameKey;
  title: string;
  executablePath: string;
  isWindowsGame: boolean;
  args?: string[];
}

export interface MacGameLaunchResult {
  success: boolean;
  pid: number | null;
  compatibility: MacGameCompatibility;
  compatibilityStack: MacCompatibilityStack | null;
  environment: MacWineEnvironment | null;
  wineVersion: MacWineVersion | null;
  logPaths: { stdout: string; stderr: string } | null;
  message: string;
}

export class MacGameLaunchManager {
  private readonly compatibilityManager: MacCompatibilityManager;
  private readonly processLogger: MacCompatibilityProcessLogger;

  constructor(
    compatibilityManager?: MacCompatibilityManager,
    processLogger?: MacCompatibilityProcessLogger
  ) {
    this.compatibilityManager =
      compatibilityManager ?? new MacCompatibilityManager();
    this.processLogger = processLogger ?? new MacCompatibilityProcessLogger();
  }

  async prepareLaunch(
    request: MacGameLaunchRequest
  ): Promise<MacGameLaunchResult> {
    const compatibility = await this.compatibilityManager.checkGame(
      request.game,
      request.title,
      request.isWindowsGame
    );

    if (!request.isWindowsGame) {
      return {
        success: true,
        pid: null,
        compatibility,
        compatibilityStack: null,
        environment: null,
        wineVersion: null,
        logPaths: null,
        message: "Native macOS game. No compatibility environment required.",
      };
    }

    if (
      compatibility.issues.some(
        (issue) => issue.code === "GRAPHICS_BACKEND_MISSING"
      )
    ) {
      return {
        success: false,
        pid: null,
        compatibility,
        compatibilityStack: null,
        environment: null,
        wineVersion: null,
        logPaths: null,
        message:
          "No compatible graphics backend is available for this game yet.",
      };
    }

    let environment = await this.compatibilityManager.getGameEnvironment(
      request.game
    );

    let wineVersions = await this.compatibilityManager.getWineVersions();

    const selectedRuntimeId =
      compatibility.compatibilityStack?.runtimeComponentId ??
      environment?.wineVersionId ??
      compatibility.recommendedWineVersionId;

    let wineVersion = this.findWineVersion(selectedRuntimeId, wineVersions);

    if (!wineVersion) {
      return {
        success: false,
        pid: null,
        compatibility,
        compatibilityStack: compatibility.compatibilityStack ?? null,
        environment,
        wineVersion: null,
        logPaths: null,
        message:
          "No compatible Windows runtime is installed for the selected stack.",
      };
    }

    if (!environment) {
      try {
        environment = await this.compatibilityManager.createGameEnvironment(
          request.game,
          compatibility.compatibilityStack
        );

        wineVersions = await this.compatibilityManager.getWineVersions();
        wineVersion = this.findWineVersion(
          environment.wineVersionId,
          wineVersions
        );
      } catch (error) {
        return {
          success: false,
          pid: null,
          compatibility,
          compatibilityStack: compatibility.compatibilityStack ?? null,
          environment: null,
          wineVersion,
          logPaths: null,
          message: this.getErrorMessage(
            error,
            "Failed to create the game's compatibility environment."
          ),
        };
      }
    }

    if (!wineVersion) {
      return {
        success: false,
        pid: null,
        compatibility,
        compatibilityStack: compatibility.compatibilityStack ?? null,
        environment,
        wineVersion: null,
        logPaths: null,
        message: "The game's selected Windows runtime is no longer available.",
      };
    }

    const healthy = await this.compatibilityManager.testGameEnvironment(
      request.game
    );

    environment =
      (await this.compatibilityManager.getGameEnvironment(request.game)) ??
      environment;

    if (!healthy) {
      try {
        environment = await this.compatibilityManager.repairGameEnvironment(
          request.game
        );
      } catch (error) {
        return {
          success: false,
          pid: null,
          compatibility,
          compatibilityStack: compatibility.compatibilityStack ?? null,
          environment,
          wineVersion,
          logPaths: null,
          message: this.getErrorMessage(
            error,
            "The game's compatibility environment needs repair."
          ),
        };
      }
    }

    return {
      success: true,
      pid: null,
      compatibility,
      compatibilityStack: compatibility.compatibilityStack ?? null,
      environment,
      wineVersion,
      logPaths: null,
      message: "Compatibility environment is ready for launch.",
    };
  }

  async launch(request: MacGameLaunchRequest): Promise<MacGameLaunchResult> {
    const prepared = await this.prepareLaunch(request);

    if (!prepared.success) return prepared;
    if (!request.isWindowsGame) return this.launchNative(request, prepared);

    if (!prepared.environment || !prepared.wineVersion) {
      return {
        ...prepared,
        success: false,
        message:
          "The Windows game's compatibility environment is not available.",
      };
    }

    return this.launchWithWine(
      request,
      prepared,
      prepared.environment,
      prepared.wineVersion,
      prepared.compatibilityStack
    );
  }

  private async launchNative(
    request: MacGameLaunchRequest,
    prepared: MacGameLaunchResult
  ): Promise<MacGameLaunchResult> {
    try {
      const workingDirectory = path.dirname(request.executablePath);
      const child = spawn(request.executablePath, request.args ?? [], {
        shell: false,
        detached: true,
        stdio: "ignore",
        cwd: workingDirectory,
        env: { ...process.env },
      });

      return await new Promise<MacGameLaunchResult>((resolve) => {
        const onSpawn = () => {
          child.off("error", onError);
          child.unref();
          resolve({
            ...prepared,
            success: true,
            pid: child.pid ?? null,
            message: "Game launched natively.",
          });
        };

        const onError = (error: Error) => {
          child.off("spawn", onSpawn);
          resolve({
            ...prepared,
            success: false,
            pid: null,
            message: this.getErrorMessage(
              error,
              "Failed to launch the native macOS game."
            ),
          });
        };

        child.once("spawn", onSpawn);
        child.once("error", onError);
      });
    } catch (error) {
      return {
        ...prepared,
        success: false,
        pid: null,
        message: this.getErrorMessage(
          error,
          "Failed to launch the native macOS game."
        ),
      };
    }
  }

  private async launchWithWine(
    request: MacGameLaunchRequest,
    prepared: MacGameLaunchResult,
    environment: MacWineEnvironment,
    wineVersion: MacWineVersion,
    stack: MacCompatibilityStack | null
  ): Promise<MacGameLaunchResult> {
    let logs: MacCompatibilityProcessLogHandle | null = null;

    try {
      const workingDirectory = path.dirname(request.executablePath);
      const env = {
        ...process.env,
        WINEPREFIX: environment.prefixPath,
      };

      if (stack?.runtimeFamily === "apple-gptk" && stack.graphicsComponentId) {
        const systemInfo = await this.compatibilityManager.getSystemInfo();
        const graphicsComponent =
          systemInfo.compatibilityComponents?.find(
            (component) => component.id === stack.graphicsComponentId
          ) ?? null;

        if (graphicsComponent?.executablePath) {
          env.D3DMETAL_FRAMEWORK_PATH = graphicsComponent.executablePath;
        }
      }

      logs = this.processLogger.open(request.game, randomUUID());

      const child = spawn(
        wineVersion.executablePath,
        [request.executablePath, ...(request.args ?? [])],
        {
          shell: false,
          detached: true,
          stdio: ["ignore", logs.stdoutFd, logs.stderrFd],
          cwd: workingDirectory,
          env,
        }
      );

      return await new Promise<MacGameLaunchResult>((resolve) => {
        const onSpawn = () => {
          child.off("error", onError);
          this.processLogger.close(logs!);
          child.unref();

          const runtimeLabel =
            stack?.runtimeFamily === "apple-gptk"
              ? "Game Porting Toolkit + D3DMetal"
              : wineVersion.name;

          resolve({
            ...prepared,
            success: true,
            pid: child.pid ?? null,
            logPaths: {
              stdout: logs!.stdoutPath,
              stderr: logs!.stderrPath,
            },
            message: `Game launched with ${runtimeLabel}.`,
          });
          logs = null;
        };

        const onError = (error: Error) => {
          child.off("spawn", onSpawn);
          this.processLogger.close(logs!);
          resolve({
            ...prepared,
            success: false,
            pid: null,
            logPaths: {
              stdout: logs!.stdoutPath,
              stderr: logs!.stderrPath,
            },
            message: this.getErrorMessage(
              error,
              "Failed to launch the Windows game with the selected compatibility stack."
            ),
          });
          logs = null;
        };

        child.once("spawn", onSpawn);
        child.once("error", onError);
      });
    } catch (error) {
      if (logs) this.processLogger.close(logs);
      return {
        ...prepared,
        success: false,
        pid: null,
        logPaths: logs
          ? { stdout: logs.stdoutPath, stderr: logs.stderrPath }
          : null,
        message: this.getErrorMessage(
          error,
          "Failed to launch the Windows game with the selected compatibility stack."
        ),
      };
    }
  }

  private findWineVersion(
    wineVersionId: string | null,
    wineVersions: MacWineVersion[]
  ): MacWineVersion | null {
    if (!wineVersionId) {
      return (
        wineVersions.find((wine) => wine.isRecommended) ??
        wineVersions[0] ??
        null
      );
    }

    return wineVersions.find((wine) => wine.id === wineVersionId) ?? null;
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
