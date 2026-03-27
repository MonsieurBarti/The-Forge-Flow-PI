// Domain — Autonomy Policy
export { getHumanGates, shouldAutoTransition } from "./domain/autonomy-policy";

// Domain — Errors
export { GuardRejectedError } from "./domain/errors/guard-rejected.error";
export { NoMatchingTransitionError } from "./domain/errors/no-matching-transition.error";
export { NoSliceAssignedError } from "./domain/errors/no-slice-assigned.error";
export { SliceAlreadyAssignedError } from "./domain/errors/slice-already-assigned.error";
export { WorkflowBaseError } from "./domain/errors/workflow-base.error";

// Domain — Escalation
export { Escalation } from "./domain/escalation.vo";

// Domain — Events
export { WorkflowEscalationRaisedEvent } from "./domain/events/workflow-escalation-raised.event";
export { WorkflowPhaseChangedEvent } from "./domain/events/workflow-phase-changed.event";

// Domain — Ports
export { WorkflowSessionRepositoryPort } from "./domain/ports/workflow-session.repository.port";

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

// Infrastructure
export { InMemoryWorkflowSessionRepository } from "./infrastructure/in-memory-workflow-session.repository";

// Extensions
export type { WorkflowExtensionDeps } from "./infrastructure/pi/workflow.extension";
export { registerWorkflowExtension } from "./infrastructure/pi/workflow.extension";

// Use Cases
export type { StatusReport } from "./use-cases/get-status.use-case";
export { GetStatusUseCase, StatusReportSchema } from "./use-cases/get-status.use-case";
