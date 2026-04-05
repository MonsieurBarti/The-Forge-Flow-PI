import { IdSchema, ModelProfileNameSchema, TimestampSchema } from "@kernel";
import { TurnMetricsSchema } from "@kernel/agents";
import { z } from "zod";

export const TaskMetricsModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  profile: ModelProfileNameSchema,
});
export type TaskMetricsModel = z.infer<typeof TaskMetricsModelSchema>;

export const TaskMetricsSchema = z.object({
  type: z.literal("task-metrics").default("task-metrics"),
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
  turns: z.array(TurnMetricsSchema).optional().default([]),
  timestamp: TimestampSchema,
});
export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;

export const QualitySnapshotSchema = z.object({
  type: z.literal("quality-snapshot"),
  sliceId: IdSchema,
  milestoneId: IdSchema,
  taskId: IdSchema,
  metrics: z.object({
    testsPassed: z.number().int().nonnegative(),
    testsFailed: z.number().int().nonnegative(),
    lintErrors: z.number().int().nonnegative(),
    typeErrors: z.number().int().nonnegative(),
  }),
  timestamp: TimestampSchema,
});
export type QualitySnapshot = z.infer<typeof QualitySnapshotSchema>;

export const MetricsEntrySchema = z.discriminatedUnion("type", [
  TaskMetricsSchema.required({ type: true }),
  QualitySnapshotSchema,
]);
export type MetricsEntry = z.infer<typeof MetricsEntrySchema>;

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
