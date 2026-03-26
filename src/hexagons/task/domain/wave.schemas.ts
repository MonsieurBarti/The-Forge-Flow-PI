import { IdSchema } from "@kernel";
import { z } from "zod";

export const TaskDependencyInputSchema = z.object({
  id: IdSchema,
  blockedBy: z.array(IdSchema).default([]),
});
export type TaskDependencyInput = z.infer<typeof TaskDependencyInputSchema>;

export const WaveSchema = z.object({
  index: z.number().int().min(0),
  taskIds: z.array(IdSchema).min(1),
});
export type Wave = z.infer<typeof WaveSchema>;
