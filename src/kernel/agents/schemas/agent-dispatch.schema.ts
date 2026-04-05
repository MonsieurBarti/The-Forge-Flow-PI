import { IdSchema } from "@kernel/schemas";
import { z } from "zod";
import { AgentTypeSchema } from "./agent-card.schema";

export const ResolvedModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type ResolvedModel = z.infer<typeof ResolvedModelSchema>;

export const AgentDispatchConfigSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  agentType: AgentTypeSchema,
  workingDirectory: z.string().min(1),
  systemPrompt: z.string(),
  taskPrompt: z.string().min(1),
  model: ResolvedModelSchema,
  tools: z.array(z.string()).min(1),
  filePaths: z.array(z.string()).default([]),
});
export type AgentDispatchConfig = z.infer<typeof AgentDispatchConfigSchema>;
