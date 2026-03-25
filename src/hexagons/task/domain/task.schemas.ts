import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const TaskStatusSchema = z.enum(["open", "in_progress", "closed", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskLabelSchema = z.string().regex(/^T\d{2,}$/);
export type TaskLabel = z.infer<typeof TaskLabelSchema>;

export const TaskPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  label: TaskLabelSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  acceptanceCriteria: z.string().default(""),
  filePaths: z.array(z.string()).default([]),
  status: TaskStatusSchema,
  blockedBy: z.array(IdSchema).default([]),
  waveIndex: z.number().int().min(0).nullable().default(null),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TaskProps = z.infer<typeof TaskPropsSchema>;
export type TaskDTO = TaskProps;
