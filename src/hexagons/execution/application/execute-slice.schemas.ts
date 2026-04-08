import {
  ComplexityTierSchema,
  IdSchema,
  ModelProfileNameSchema,
  ResolvedModelSchema,
} from "@kernel";
import { z } from "zod";

export const ExecuteSliceInputSchema = z.object({
  sliceId: IdSchema,
  milestoneId: IdSchema,
  sliceLabel: z.string().min(1),
  sliceTitle: z.string().min(1),
  complexity: ComplexityTierSchema,
  model: ResolvedModelSchema,
  modelProfile: ModelProfileNameSchema,
  workingDirectory: z.string().min(1),
});
export type ExecuteSliceInput = z.infer<typeof ExecuteSliceInputSchema>;

export const ExecuteSliceResultSchema = z.object({
  sliceId: IdSchema,
  completedTasks: z.array(IdSchema),
  failedTasks: z.array(IdSchema),
  skippedTasks: z.array(IdSchema),
  wavesCompleted: z.number().int().nonnegative(),
  totalWaves: z.number().int().nonnegative(),
  aborted: z.boolean(),
  taskErrors: z.record(z.string(), z.string()).optional(),
});
export type ExecuteSliceResult = z.infer<typeof ExecuteSliceResultSchema>;
