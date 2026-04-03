import { IdSchema } from "@kernel/schemas";
import { z } from "zod";

const AgentEventBaseSchema = z.object({
  taskId: IdSchema,
  turnIndex: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
});

export const AgentTurnStartSchema = AgentEventBaseSchema.extend({
  type: z.literal("turn_start"),
});
export type AgentTurnStart = z.infer<typeof AgentTurnStartSchema>;

export const AgentTurnEndSchema = AgentEventBaseSchema.extend({
  type: z.literal("turn_end"),
  toolCallCount: z.number().int().nonnegative(),
});
export type AgentTurnEnd = z.infer<typeof AgentTurnEndSchema>;

export const AgentMessageStartSchema = AgentEventBaseSchema.extend({
  type: z.literal("message_start"),
});
export type AgentMessageStart = z.infer<typeof AgentMessageStartSchema>;

export const AgentMessageUpdateSchema = AgentEventBaseSchema.extend({
  type: z.literal("message_update"),
  textDelta: z.string(),
});
export type AgentMessageUpdate = z.infer<typeof AgentMessageUpdateSchema>;

export const AgentMessageEndSchema = AgentEventBaseSchema.extend({
  type: z.literal("message_end"),
});
export type AgentMessageEnd = z.infer<typeof AgentMessageEndSchema>;

export const AgentToolExecutionStartSchema = AgentEventBaseSchema.extend({
  type: z.literal("tool_execution_start"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});
export type AgentToolExecutionStart = z.infer<typeof AgentToolExecutionStartSchema>;

export const AgentToolExecutionUpdateSchema = AgentEventBaseSchema.extend({
  type: z.literal("tool_execution_update"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});
export type AgentToolExecutionUpdate = z.infer<typeof AgentToolExecutionUpdateSchema>;

export const AgentToolExecutionEndSchema = AgentEventBaseSchema.extend({
  type: z.literal("tool_execution_end"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  isError: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
export type AgentToolExecutionEnd = z.infer<typeof AgentToolExecutionEndSchema>;

export const AgentEventSchema = z.discriminatedUnion("type", [
  AgentTurnStartSchema,
  AgentTurnEndSchema,
  AgentMessageStartSchema,
  AgentMessageUpdateSchema,
  AgentMessageEndSchema,
  AgentToolExecutionStartSchema,
  AgentToolExecutionUpdateSchema,
  AgentToolExecutionEndSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
