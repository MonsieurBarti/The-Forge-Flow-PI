import { z } from "zod";

export const ToolCallMetricsSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  isError: z.boolean(),
});
export type ToolCallMetrics = z.infer<typeof ToolCallMetricsSchema>;

export const TurnMetricsSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  toolCalls: z.array(ToolCallMetricsSchema).default([]),
  durationMs: z.number().int().nonnegative(),
});
export type TurnMetrics = z.infer<typeof TurnMetricsSchema>;
