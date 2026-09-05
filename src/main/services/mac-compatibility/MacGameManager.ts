import type {
  MacCompatibilityGameKey,
  MacGameCompatibility,
} from "./MacCompatibilityTypes.js";
import { MacCompatibilityManager } from "./MacCompatibilityManager.js";
import {
  MacCompatibilityRecoveryEngine,
  type MacCompatibilityRecoveryRequest,
  type MacCompatibilityRecoveryResult,
} from "./MacCompatibilityRecoveryEngine.js";
import { MacScreenObserverProcessClient } from "./MacScreenObserverProcessClient.js";

export class MacGameManager {
  private readonly compatibilityManager: MacCompatibilityManager;
  private readonly recoveryEngine: MacCompatibilityRecoveryEngine;

  constructor(
    compatibilityManager?: MacCompatibilityManager,
    recoveryEngine?: MacCompatibilityRecoveryEngine
  ) {
    this.compatibilityManager =
      compatibilityManager ?? new MacCompatibilityManager();
    this.recoveryEngine =
      recoveryEngine ??
      new MacCompatibilityRecoveryEngine({
        screenObserver: new MacScreenObserverProcessClient(),
      });
  }

  async checkGame(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean
  ): Promise<MacGameCompatibility> {
    return this.compatibilityManager.checkGame(game, title, isWindowsGame);
  }

  async getEnvironment(
    game: MacCompatibilityGameKey
  ) {
    return this.compatibilityManager.getGameEnvironment(game);
  }

  async fixGame(
    request: MacCompatibilityRecoveryRequest
  ): Promise<MacCompatibilityRecoveryResult> {
    return this.recoveryEngine.fixGame(request);
  }

  async isReadyToLaunch(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean
  ): Promise<boolean> {
    if (!isWindowsGame) return true;
    const compatibility = await this.checkGame(game, title, isWindowsGame);
    return compatibility.status === "ready";
  }

  async getLaunchStatus(
    game: MacCompatibilityGameKey,
    title: string,
    isWindowsGame: boolean
  ): Promise<{
    ready: boolean;
    compatibility: MacGameCompatibility;
    message: string;
  }> {
    const compatibility = await this.checkGame(game, title, isWindowsGame);
    if (!isWindowsGame) {
      return {
        ready: true,
        compatibility,
        message: "Native macOS game is ready to launch.",
      };
    }
    if (compatibility.status === "ready") {
      return {
        ready: true,
        compatibility,
        message: "Game environment is ready.",
      };
    }
    if (compatibility.status === "needs_setup") {
      return {
        ready: false,
        compatibility,
        message: "Game requires a macOS compatibility environment.",
      };
    }
    if (compatibility.status === "needs_repair") {
      return {
        ready: false,
        compatibility,
        message: "Game environment needs repair before launching.",
      };
    }
    if (compatibility.status === "unsupported") {
      return {
        ready: false,
        compatibility,
        message: "This game is not currently supported on macOS.",
      };
    }
    if (compatibility.status === "error") {
      return {
        ready: false,
        compatibility,
        message: "Unable to prepare the game for macOS.",
      };
    }
    return {
      ready: false,
      compatibility,
      message: "Game compatibility has not been fully configured.",
    };
  }
}
