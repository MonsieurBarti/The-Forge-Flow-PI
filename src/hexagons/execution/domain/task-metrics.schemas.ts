import { IdSchema, ModelProfileNameSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const TaskMetricsModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  profile: ModelProfileNameSchema,
});
export type TaskMetricsModel = z.infer<typeof TaskMetricsModelSchema>;

export const TaskMetricsSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  model: TaskMetricsModelSchema,
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  success: z.boolean(),
  retries: z.number().int().nonnegative().default(0),
  downshifted: z.boolean().default(false),
  reflectionPassed: z.boolean().optional(),
  reflectionTier: z.enum(["fast", "full", "skipped"]).default("skipped"),
  finalProfile: z.string().optional(),
  totalAttempts: z.number().int().nonnegative().optional(),
  timestamp: TimestampSchema,
});
export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;

export const ModelBreakdownEntrySchema = z.object({
  modelId: z.string(),
  taskCount: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
});
export type ModelBreakdownEntry = z.infer<typeof ModelBreakdownEntrySchema>;

export const AggregatedMetricsSchema = z.object({
  groupKey: z.object({
    sliceId: IdSchema.optional(),
    milestoneId: IdSchema.optional(),
  }),
  totalCostUsd: z.number().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  averageCostPerTask: z.number().nonnegative(),
  modelBreakdown: z.array(ModelBreakdownEntrySchema),
});
export type AggregatedMetrics = z.infer<typeof AggregatedMetricsSchema>;
