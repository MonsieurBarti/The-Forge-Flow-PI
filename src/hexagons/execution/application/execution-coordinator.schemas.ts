import {
  ComplexityTierSchema,
  IdSchema,
  ModelProfileNameSchema,
  ResolvedModelSchema,
} from "@kernel";
import { z } from "zod";

export const StartExecutionInputSchema = z.object({
  sliceId: IdSchema,
  milestoneId: IdSchema,
  sliceLabel: z.string().min(1),
  sliceTitle: z.string().min(1),
  complexity: ComplexityTierSchema,
  model: ResolvedModelSchema,
  modelProfile: ModelProfileNameSchema,
  workingDirectory: z.string().min(1),
});
export type StartExecutionInput = z.infer<typeof StartExecutionInputSchema>;

export const ExecutionResultSchema = z.object({
  sliceId: IdSchema,
  completedTasks: z.array(IdSchema),
  failedTasks: z.array(IdSchema),
  skippedTasks: z.array(IdSchema),
  wavesCompleted: z.number().int().nonnegative(),
  totalWaves: z.number().int().nonnegative(),
  status: z.enum(["completed", "failed", "paused"]),
  failureReason: z.string().optional(),
  taskErrors: z.record(z.string(), z.string()).optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const PauseAcknowledgementSchema = z.object({
  sliceId: IdSchema,
  status: z.literal("paused"),
});
export type PauseAcknowledgement = z.infer<typeof PauseAcknowledgementSchema>;
