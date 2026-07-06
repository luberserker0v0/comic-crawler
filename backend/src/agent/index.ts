export { SessionManager } from './session-manager';
export { TriggerManager } from './trigger-manager';
export { VersionManager } from './version-manager';
export { WorkspaceFactory } from './workspace-factory';
export { WorkspaceManager } from './workspace-manager';
export { CodeValidator } from './code-validator';
export { AgentNotifier } from './notifier';
export { AgentAdminService } from './admin-service';
export { AgentMaintenanceLoop } from './maintenance-loop';
export { RollbackManager } from './rollback-manager';
export { PromotionManager } from './promotion-manager';
export { buildExtractionFailureContext } from './error-context';
export type {
  AgentNotification,
  AgentSession,
  AgentVersion,
  AgentVersions,
  AgentAttempt,
  FixtureValidationResult,
  ExtractionFailureContext,
  TriggerFailureRecord,
  AgentSessionStatus,
  AgentVersionStatus,
  CandidateReviewNotification,
  RollbackNotification,
} from './types';
export type { WorkspacePaths } from './workspace-manager';
export type { SessionWorkspace, WorkspaceSourceSnapshot, CreateSessionWorkspaceOptions } from './workspace-factory';
export type { ValidationResult } from './code-validator';
export type { AgentMaintenanceConfig, MaintenanceResult } from './maintenance-loop';
export type { RollbackResult } from './rollback-manager';
export type { AgentNotifierSink, CandidateNotificationOptions, RollbackNotificationOptions } from './notifier';
export type { PromotionResult } from './promotion-manager';
export type { TriggerManagerConfig, TriggerEvaluation } from './trigger-manager';
export type { AgentAdapterState } from './admin-service';
