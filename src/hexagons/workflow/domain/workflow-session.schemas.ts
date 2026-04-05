import { AutonomyModeSchema } from "@hexagons/settings";
import { ComplexityTierSchema, IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const WorkflowPhaseSchema = z.enum([
  "idle",
  "discussing",
  "researching",
  "planning",
  "executing",
  "verifying",
  "reviewing",
  "shipping",
  "completing-milestone",
  "paused",
  "blocked",
]);
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const WorkflowTriggerSchema = z.enum([
  "start",
  "next",
  "skip",
  "back",
  "fail",
  "approve",
  "reject",
  "pause",
  "resume",
  "abort",
]);
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

export const EscalationPropsSchema = z.object({
  sliceId: IdSchema,
  phase: WorkflowPhaseSchema,
  reason: z.string(),
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
  occurredAt: TimestampSchema,
});
export type EscalationProps = z.infer<typeof EscalationPropsSchema>;

export const AutoTransitionDecisionSchema = z.object({
  autoTransition: z.boolean(),
  isHumanGate: z.boolean(),
});
export type AutoTransitionDecision = z.infer<typeof AutoTransitionDecisionSchema>;

export const WorkflowSessionPropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema.nullable().default(null),
  sliceId: IdSchema.optional(),
  currentPhase: WorkflowPhaseSchema,
  previousPhase: WorkflowPhaseSchema.optional(),
  retryCount: z.number().int().min(0).default(0),
  autonomyMode: AutonomyModeSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastEscalation: EscalationPropsSchema.nullable().default(null),
});
export type WorkflowSessionProps = z.infer<typeof WorkflowSessionPropsSchema>;

export const GuardNameSchema = z.enum([
  "notSTier",
  "isSTier",
  "allSlicesClosed",
  "retriesExhausted",
]);
export type GuardName = z.infer<typeof GuardNameSchema>;

export const TransitionEffectSchema = z.enum([
  "incrementRetry",
  "savePreviousPhase",
  "restorePreviousPhase",
  "resetRetryCount",
  "clearSlice",
]);
export type TransitionEffect = z.infer<typeof TransitionEffectSchema>;

export const GuardContextSchema = z.object({
  complexityTier: ComplexityTierSchema.nullable(),
  retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(0),
  allSlicesClosed: z.boolean(),
  lastError: z.string().nullable().default(null),
});
export type GuardContext = z.infer<typeof GuardContextSchema>;

export const TransitionRuleSchema = z.object({
  from: WorkflowPhaseSchema.or(z.literal("*active*")),
  trigger: WorkflowTriggerSchema,
  to: WorkflowPhaseSchema.or(z.literal("*previousPhase*")),
  guard: GuardNameSchema.optional(),
  effects: z.array(TransitionEffectSchema).default([]),
});
export type TransitionRule = z.infer<typeof TransitionRuleSchema>;
