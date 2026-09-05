export { MacCompatibilityManager } from "./MacCompatibilityManager.js";
export { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.js";
export { MacCompatibilityAnalyzer } from "./MacCompatibilityAnalyzer.js";
export { MacCompatibilityComponentDetector } from "./MacCompatibilityComponentDetector.js";
export { MacCompatibilityDiagnosticCollector } from "./MacCompatibilityDiagnosticCollector.js";
export { MacCompatibilityExperimentManager } from "./MacCompatibilityExperimentManager.js";
export { MacCompatibilityRecoveryPlanner } from "./MacCompatibilityRecoveryPlanner.js";
export { MacCompatibilityStackSelector } from "./MacCompatibilityStackSelector.js";
export { MacCompatibilityStackProvisioner } from "./MacCompatibilityStackProvisioner.js";
export { MacGameManager } from "./MacGameManager.js";
export { MacSystemDetector } from "./MacSystemDetector.js";
export { MacWineDetector } from "./MacWineDetector.js";

export {
  MacGameLaunchController,
  MacGameLaunchManager,
  type MacGameLaunchRequest,
  type MacGameLaunchResult,
} from "./launch/index.js";

export {
  MacWineEnvironmentHealthChecker,
  MacWineEnvironmentInitializer,
  MacWineEnvironmentManager,
  MacWineEnvironmentRegistry,
  MacWineEnvironmentRepairer,
} from "./environment/index.js";

export type {
  MacArchitecture,
  MacCompatibilityAction,
  MacCompatibilityCheckResult,
  MacCompatibilityComponent,
  MacCompatibilityComponentType,
  MacCompatibilityDiagnosticEvidence,
  MacCompatibilityDiagnosticRecord,
  MacCompatibilityExperiment,
  MacCompatibilityGameKey,
  MacCompatibilityIssue,
  MacCompatibilityLastKnownGood,
  MacCompatibilityLevel,
  MacCompatibilityOperationProgress,
  MacCompatibilityOperationResult,
  MacCompatibilityPlatform,
  MacCompatibilityRecommendation,
  MacCompatibilityRegistryEntry,
  MacCompatibilityStack,
  MacCompatibilityStatus,
  MacGameCompatibility,
  MacGraphicsApi,
  MacSystemInfo,
  MacWineEnvironment,
  MacWineType,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";

export type {
  MacCompatibilityStackCandidate,
  MacCompatibilityStackSelectionInput,
} from "./MacCompatibilityStackSelector.js";

export type {
  MacCompatibilityStackProvisionResult,
  MacCompatibilityStackProvisionerDependencies,
} from "./MacCompatibilityStackProvisioner.js";

export type { MacCompatibilityAnalysis, MacCompatibilityAnalyzerDependencies } from "./MacCompatibilityAnalyzer.js";
export type { MacCompatibilityRecoveryCandidate } from "./MacCompatibilityRecoveryPlanner.js";
export type { MacGameRequirements } from "./MacGameRequirementsCatalog.js";
export { getMacGameRequirements } from "./MacGameRequirementsCatalog.js";

export type {
  MacScreenObserver,
  MacScreenObservationResult,
  MacScreenTextObservation,
} from "./MacScreenObservationTypes.js";
