import { IdSchema } from "@kernel/schemas";
import { z } from "zod";
import { AgentTypeSchema } from "./agent-card.schema";
import {
  AgentConcernSchema,
  AgentStatusSchema,
  SelfReviewChecklistSchema,
} from "./agent-status.schema";
import { TurnMetricsSchema } from "./turn-metrics.schema";

export const AgentCostSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type AgentCost = z.infer<typeof AgentCostSchema>;

export const AgentResultSchema = z.object({
  taskId: IdSchema,
  agentType: AgentTypeSchema,
  status: AgentStatusSchema,
  output: z.string(),
  filesChanged: z.array(z.string()).default([]),
  concerns: z.array(AgentConcernSchema).default([]),
  selfReview: SelfReviewChecklistSchema,
  cost: AgentCostSchema,
  durationMs: z.number().int().nonnegative(),
  turns: z.array(TurnMetricsSchema).default([]),
  error: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
