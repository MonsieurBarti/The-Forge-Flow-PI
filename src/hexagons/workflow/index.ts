// Domain — Autonomy Policy
export { getHumanGates, shouldAutoTransition } from "./domain/autonomy-policy";
export { ContextPackageBuilder } from "./domain/context-package.builder";
export {
  buildTaskPrompt,
  isActivePhase,
  PHASE_AGENT_MAP,
  resolveAgentType,
} from "./domain/context-package.helpers";
export type {
  ContextPackageProps,
  SkillName,
  SkillReference,
  SkillType,
} from "./domain/context-package.schemas";
export {
  ContextPackagePropsSchema,
  SKILL_NAMES,
  SkillNameSchema,
  SkillReferenceSchema,
  SkillTypeSchema,
} from "./domain/context-package.schemas";
// Domain — Context Package
export { ContextPackage } from "./domain/context-package.value-object";
// Domain — Context Staging Errors
export {
  ContextStagingError,
  InvalidPhaseForStagingError,
} from "./domain/errors/context-staging.error";
// Domain — Errors
export { FileIOError } from "./domain/errors/file-io.error";
export { GuardRejectedError } from "./domain/errors/guard-rejected.error";
export { NoMatchingTransitionError } from "./domain/errors/no-matching-transition.error";
export { NoSliceAssignedError } from "./domain/errors/no-slice-assigned.error";
export { SliceAlreadyAssignedError } from "./domain/errors/slice-already-assigned.error";
export { SliceTransitionError } from "./domain/errors/slice-transition.error";
export { WorkflowBaseError } from "./domain/errors/workflow-base.error";
// Domain — Escalation
export { Escalation } from "./domain/escalation.vo";
// Domain — Events
export { WorkflowEscalationRaisedEvent } from "./domain/events/workflow-escalation-raised.event";
export { WorkflowPhaseChangedEvent } from "./domain/events/workflow-phase-changed.event";
// Domain — Next Step Suggestion
export {
  type NextStepContext,
  NextStepContextSchema,
  NextStepSuggestion,
  type NextStepSuggestionProps,
  NextStepSuggestionPropsSchema,
} from "./domain/next-step-suggestion.vo";
// Domain — Phase Skill Map
export {
  PHASE_SKILL_MAP,
  SKILL_REGISTRY,
  selectSkillsForPhase,
} from "./domain/phase-skill-map";
// Domain — Phase-Status Mapping
export { mapPhaseToSliceStatus } from "./domain/phase-status-mapping";
// Domain — Ports
export {
  ARTIFACT_FILENAMES,
  ArtifactFilePort,
  type ArtifactType,
  ArtifactTypeSchema,
} from "./domain/ports/artifact-file.port";
export { AutonomyModeProvider } from "./domain/ports/autonomy-mode.provider";
// Domain — Context Staging Ports
export type { ContextStagingRequest } from "./domain/ports/context-staging.port";
export {
  ContextStagingPort,
  ContextStagingRequestSchema,
} from "./domain/ports/context-staging.port";
export { ModelProfileResolverPort } from "./domain/ports/model-profile-resolver.port";
export { SliceTransitionPort } from "./domain/ports/slice-transition.port";
export { WorkflowSessionRepositoryPort } from "./domain/ports/workflow-session.repository.port";
export { WorkflowJournalPort } from "./domain/ports/workflow-journal.port";
export type { WorkflowJournalEntry } from "./domain/ports/workflow-journal.port";
export { WorkflowJournalEntrySchema } from "./domain/ports/workflow-journal.port";
// Domain — Transition Table
export {
  ACTIVE_PHASES,
  evaluateGuard,
  findMatchingRules,
  TRANSITION_TABLE,
} from "./domain/transition-table";
// Domain — Aggregate
export { WorkflowSession } from "./domain/workflow-session.aggregate";
// Domain — Builder
export { WorkflowSessionBuilder } from "./domain/workflow-session.builder";
// Domain — Schemas
export type {
  AutoTransitionDecision,
  EscalationProps,
  GuardContext,
  GuardName,
  TransitionEffect,
  TransitionRule,
  WorkflowPhase,
  WorkflowSessionProps,
  WorkflowTrigger,
} from "./domain/workflow-session.schemas";
export {
  AutoTransitionDecisionSchema,
  EscalationPropsSchema,
  GuardContextSchema,
  GuardNameSchema,
  TransitionEffectSchema,
  TransitionRuleSchema,
  WorkflowPhaseSchema,
  WorkflowSessionPropsSchema,
  WorkflowTriggerSchema,
} from "./domain/workflow-session.schemas";
// Infrastructure — Adapters
export { InMemoryArtifactFileAdapter } from "./infrastructure/in-memory-artifact-file.adapter";
export { DefaultContextStagingAdapter } from "./infrastructure/default-context-staging.adapter";
export { InMemoryWorkflowSessionRepository } from "./infrastructure/in-memory-workflow-session.repository";
// Infrastructure — PI Tools & Commands
export { createClassifyComplexityTool } from "./infrastructure/pi/classify-complexity.tool";
export {
  type DiscussCommandDeps,
  registerDiscussCommand,
} from "./infrastructure/pi/discuss.command";
export {
  buildDiscussProtocolMessage,
  type DiscussProtocolParams,
} from "./infrastructure/pi/discuss-protocol";
export {
  type PlanCommandDeps,
  registerPlanCommand,
} from "./infrastructure/pi/plan.command";
export {
  buildPlanProtocolMessage,
  type PlanProtocolParams,
} from "./infrastructure/pi/plan-protocol";
export {
  type ResearchCommandDeps,
  registerResearchCommand,
} from "./infrastructure/pi/research.command";
export {
  buildResearchProtocolMessage,
  type ResearchProtocolParams,
} from "./infrastructure/pi/research-protocol";
export type { WorkflowExtensionDeps } from "./infrastructure/pi/workflow.extension";
export { registerWorkflowExtension } from "./infrastructure/pi/workflow.extension";
export {
  createWorkflowTransitionTool,
  type WorkflowTransitionToolDeps,
} from "./infrastructure/pi/workflow-transition.tool";
export { createWritePlanTool } from "./infrastructure/pi/write-plan.tool";
export { createWriteResearchTool } from "./infrastructure/pi/write-research.tool";
export { createWriteSpecTool } from "./infrastructure/pi/write-spec.tool";

// Use Cases
export { ClassifyComplexityUseCase } from "./use-cases/classify-complexity.use-case";
export type { StatusReport } from "./use-cases/get-status.use-case";
export { GetStatusUseCase, StatusReportSchema } from "./use-cases/get-status.use-case";
export type {
  PhaseTransitionInput,
  PhaseTransitionResult,
} from "./use-cases/orchestrate-phase-transition.use-case";
export {
  OrchestratePhaseTransitionUseCase,
  WorkflowSessionNotFoundError,
} from "./use-cases/orchestrate-phase-transition.use-case";
export {
  type StartDiscussInput,
  type StartDiscussOutput,
  StartDiscussUseCase,
} from "./use-cases/start-discuss.use-case";
export {
  type SuggestNextStepInput,
  SuggestNextStepUseCase,
} from "./use-cases/suggest-next-step.use-case";
export type { WritePlanInput } from "./use-cases/write-plan.use-case";
export { WritePlanUseCase } from "./use-cases/write-plan.use-case";
export { WriteResearchUseCase } from "./use-cases/write-research.use-case";
export { WriteSpecUseCase } from "./use-cases/write-spec.use-case";
