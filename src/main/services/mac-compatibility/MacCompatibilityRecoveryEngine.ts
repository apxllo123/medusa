import { MacCompatibilityAnalyzer } from "./MacCompatibilityAnalyzer.js";
import {
  createDiagnosticRecord,
  createProcessDiagnosticEvidence,
  createScreenDiagnosticEvidence,
} from "./MacCompatibilityDiagnosticCollector.js";
import { MacCompatibilityExperimentManager } from "./MacCompatibilityExperimentManager.js";
import { MacCompatibilityRecoveryPlanner } from "./MacCompatibilityRecoveryPlanner.js";
import { MacCompatibilityStackProvisioner } from "./MacCompatibilityStackProvisioner.js";
import { MacCompatibilityWorkingStateVerifier } from "./MacCompatibilityWorkingStateVerifier.js";
import { MacCompatibilityProcessLogger } from "./MacCompatibilityProcessLogger.js";
import type {
  MacCompatibilityExperiment,
  MacGameCompatibility,
} from "./MacCompatibilityTypes.js";
import {
  MacGameLaunchManager,
  type MacGameLaunchRequest,
  type MacGameLaunchResult,
} from "./launch/MacGameLaunchManager.js";
import type { MacScreenObserver } from "./MacScreenObservationTypes.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const STARTUP_OBSERVATION_DELAY_MS = 5_000;

export interface MacCompatibilityRecoveryRequest extends MacGameLaunchRequest {
  maxAttempts?: number;
}

export interface MacCompatibilityRecoveryAttempt {
  experiment: MacCompatibilityExperiment;
  launch: MacGameLaunchResult | null;
  verified: boolean;
  reason: string;
  failureSignature: string | null;
}

export interface MacCompatibilityRecoveryResult {
  success: boolean;
  attempts: MacCompatibilityRecoveryAttempt[];
  selectedExperimentId: string | null;
  message: string;
}

export interface MacCompatibilityRecoveryEngineDependencies {
  analyzer?: MacCompatibilityAnalyzer;
  provisioner?: MacCompatibilityStackProvisioner;
  experimentManager?: MacCompatibilityExperimentManager;
  recoveryPlanner?: MacCompatibilityRecoveryPlanner;
  launchManager?: MacGameLaunchManager;
  processLogger?: MacCompatibilityProcessLogger;
  screenObserver: MacScreenObserver;
  workingStateVerifier?: MacCompatibilityWorkingStateVerifier;
}

export class MacCompatibilityRecoveryEngine {
  private readonly analyzer: MacCompatibilityAnalyzer;
  private readonly provisioner: MacCompatibilityStackProvisioner;
  private readonly experimentManager: MacCompatibilityExperimentManager;
  private readonly recoveryPlanner: MacCompatibilityRecoveryPlanner;
  private readonly launchManager: MacGameLaunchManager;
  private readonly processLogger: MacCompatibilityProcessLogger;
  private readonly workingStateVerifier: MacCompatibilityWorkingStateVerifier;

  constructor(dependencies: MacCompatibilityRecoveryEngineDependencies) {
    this.analyzer = dependencies.analyzer ?? new MacCompatibilityAnalyzer();
    this.provisioner =
      dependencies.provisioner ?? new MacCompatibilityStackProvisioner();
    this.experimentManager =
      dependencies.experimentManager ?? new MacCompatibilityExperimentManager();
    this.recoveryPlanner =
      dependencies.recoveryPlanner ?? new MacCompatibilityRecoveryPlanner();
    this.launchManager =
      dependencies.launchManager ?? new MacGameLaunchManager();
    this.processLogger =
      dependencies.processLogger ?? new MacCompatibilityProcessLogger();
    this.workingStateVerifier =
      dependencies.workingStateVerifier ??
      new MacCompatibilityWorkingStateVerifier({
        screenObserver: dependencies.screenObserver,
      });
  }

  async fixGame(
    request: MacCompatibilityRecoveryRequest
  ): Promise<MacCompatibilityRecoveryResult> {
    const analysis = await this.analyzer.analyze(request.game);
    const compatibility = this.analyzerToCompatibility(request, analysis);
    const maxAttempts = Math.max(
      1,
      Math.min(request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 10)
    );

    const existingExperiments = this.experimentManager.getExperiments(
      request.game
    );
    const knownFailedStackIds = new Set(
      existingExperiments
        .filter((experiment) => experiment.status === "failed")
        .map((experiment) => experiment.stack.id)
    );

    const candidateStacks = analysis.candidates.filter((candidate) => {
      if (!candidate.eligible) return false;
      return !knownFailedStackIds.has(candidate.stack.id);
    });

    const attempts: MacCompatibilityRecoveryAttempt[] = [];

    for (const candidate of candidateStacks.slice(0, maxAttempts)) {
      const experiment = this.experimentManager.start(
        request.game,
        candidate.stack,
        analysis.systemInfo.availableDiskBytes
      );
      this.experimentManager.markRunning(request.game, experiment.id);

      try {
        const provision = await this.provisioner.provisionIsolated(
          request.game,
          candidate,
          analysis.wineVersions,
          experiment.prefixPath ?? ""
        );

        if (!provision.success || !provision.environment) {
          const failureSignature = provision.message.toUpperCase().slice(0, 1_000);
          this.experimentManager.markFailed(
            request.game,
            experiment.id,
            failureSignature,
            [provision.message]
          );

          attempts.push({
            experiment,
            launch: null,
            verified: false,
            reason: provision.message,
            failureSignature,
          });
          continue;
        }

        const wineVersion = analysis.wineVersions.find(
          (wine) => wine.id === candidate.stack.runtimeComponentId
        );

        if (!wineVersion) {
          const reason = "Selected runtime disappeared during the experiment.";
          this.experimentManager.markFailed(
            request.game,
            experiment.id,
            reason.toUpperCase(),
            [reason]
          );
          attempts.push({
            experiment,
            launch: null,
            verified: false,
            reason,
            failureSignature: reason.toUpperCase(),
          });
          continue;
        }

        const launch = await this.launchManager.launchInCompatibilityEnvironment(
          request,
          compatibility,
          provision.environment,
          wineVersion,
          candidate.stack
        );

        await this.delay(STARTUP_OBSERVATION_DELAY_MS);

        const logEvidence = launch.logPaths
          ? createProcessDiagnosticEvidence(
              this.processLogger.read(launch.logPaths.stdout),
              this.processLogger.read(launch.logPaths.stderr)
            )
          : [];
        const priorDiagnostics = this.experimentManager.getDiagnostics(request.game);
        const screenObservation = await this.workingStateVerifier.verify(
          request.game.shop,
          request.game.objectId,
          priorDiagnostics
        );
        const screenEvidence = screenObservation.observation
          ? createScreenDiagnosticEvidence(screenObservation.observation)
          : [];
        const diagnostic = createDiagnosticRecord([
          ...logEvidence,
          ...screenEvidence,
        ]);
        this.experimentManager.addDiagnostic(request.game, diagnostic);

        if (launch.success && screenObservation.verified) {
          this.experimentManager.markPassed(request.game, experiment.id, [
            screenObservation.reason,
          ]);
          this.experimentManager.promoteVerified(request.game, experiment.id, [
            "Promoted after observable game working-state verification.",
          ]);

          attempts.push({
            experiment,
            launch,
            verified: true,
            reason: screenObservation.reason,
            failureSignature: null,
          });

          return {
            success: true,
            attempts,
            selectedExperimentId: experiment.id,
            message: "A verified compatibility stack was found and promoted.",
          };
        }

        const failureSignature =
          diagnostic.failureSignature ??
          (screenObservation.reason || launch.message).toUpperCase();
        const reason = screenObservation.reason || launch.message;

        this.experimentManager.markFailed(
          request.game,
          experiment.id,
          failureSignature,
          [reason]
        );

        attempts.push({
          experiment,
          launch,
          verified: false,
          reason,
          failureSignature,
        });
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "Unexpected error while running compatibility experiment.";
        const failureSignature = reason.toUpperCase().slice(0, 1_000);
        this.experimentManager.markFailed(
          request.game,
          experiment.id,
          failureSignature,
          [reason]
        );
        attempts.push({
          experiment,
          launch: null,
          verified: false,
          reason,
          failureSignature,
        });
      }
    }

    const plan = this.recoveryPlanner.plan(
      this.experimentManager.getDiagnostics(request.game),
      this.experimentManager.getLastKnownGood(request.game) !== null
    );

    return {
      success: false,
      attempts,
      selectedExperimentId: null,
      message:
        attempts.length === 0
          ? `No eligible compatibility stack is currently available. ${plan[0]?.reason ?? "Additional evidence is required."}`
          : `No compatibility stack passed working-state verification after ${attempts.length} experiment(s). Next diagnostic action: ${plan[0]?.title ?? "collect more evidence"}.`,
    };
  }

  private analyzerToCompatibility(
    request: MacCompatibilityRecoveryRequest,
    analysis: Awaited<ReturnType<MacCompatibilityAnalyzer["analyze"]>>
  ): MacGameCompatibility {
    const selected =
      analysis.candidates.find((candidate) => candidate.eligible)?.stack ?? null;

    return {
      shop: request.game.shop,
      objectId: request.game.objectId,
      title: request.title,
      status: selected ? "needs_setup" : "unsupported",
      level: selected ? "fair" : "unsupported",
      score: analysis.candidates[0]?.score ?? null,
      isWindowsGame: request.isWindowsGame,
      requiresWine: request.isWindowsGame,
      requiresRosetta: analysis.systemInfo.isAppleSilicon,
      recommendedWineVersionId: selected?.runtimeComponentId ?? null,
      recommendedWineVersionName:
        analysis.wineVersions.find(
          (wine) => wine.id === selected?.runtimeComponentId
        )?.name ?? null,
      environment: null,
      compatibilityStack: selected,
      issues: [],
      recommendations: [],
    };
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
