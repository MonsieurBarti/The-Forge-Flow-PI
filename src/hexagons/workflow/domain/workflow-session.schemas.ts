import { AutonomyModeSchema } from "@hexagons/settings";
import { IdSchema, TimestampSchema } from "@kernel";
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

export const WorkflowSessionPropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  sliceId: IdSchema.optional(),
  currentPhase: WorkflowPhaseSchema,
  previousPhase: WorkflowPhaseSchema.optional(),
  retryCount: z.number().int().min(0).default(0),
  autonomyMode: AutonomyModeSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type WorkflowSessionProps = z.infer<typeof WorkflowSessionPropsSchema>;
