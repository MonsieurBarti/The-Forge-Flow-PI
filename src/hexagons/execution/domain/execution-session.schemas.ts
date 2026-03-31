import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const ExecutionSessionStatusSchema = z.enum([
  "created",
  "running",
  "paused",
  "completed",
  "failed",
]);
export type ExecutionSessionStatus = z.infer<typeof ExecutionSessionStatusSchema>;

export const ExecutionSessionPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  status: ExecutionSessionStatusSchema,
  resumeCount: z.number().int().min(0),
  failureReason: z.string().optional(),
  startedAt: TimestampSchema.optional(),
  pausedAt: TimestampSchema.optional(),
  completedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ExecutionSessionProps = z.infer<typeof ExecutionSessionPropsSchema>;
