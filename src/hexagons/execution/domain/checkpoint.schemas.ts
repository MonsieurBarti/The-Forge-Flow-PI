import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const ExecutorLogEntrySchema = z.object({
  taskId: IdSchema,
  agentIdentity: z.string().min(1),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable().default(null),
});
export type ExecutorLogEntry = z.infer<typeof ExecutorLogEntrySchema>;

export const CheckpointPropsSchema = z.object({
  version: z.number().int().default(1),
  id: IdSchema,
  sliceId: IdSchema,
  baseCommit: z.string().min(1),
  currentWaveIndex: z.number().int().min(0),
  completedWaves: z.array(z.number().int()),
  completedTasks: z.array(IdSchema),
  executorLog: z.array(ExecutorLogEntrySchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type CheckpointProps = z.infer<typeof CheckpointPropsSchema>;
export type CheckpointDTO = CheckpointProps;
