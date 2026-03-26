import { z } from "zod";
import { ModelProfileNameSchema } from "@kernel/schemas";

export const AgentTypeSchema = z.enum([
  "spec-reviewer",
  "code-reviewer",
  "security-auditor",
  "fixer",
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentCapabilitySchema = z.enum(["review", "fix"]);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const AgentCardSchema = z.object({
  type: AgentTypeSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(AgentCapabilitySchema).min(1),
  defaultModelProfile: ModelProfileNameSchema,
  requiredTools: z.array(z.string()),
  optionalTools: z.array(z.string()).default([]),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
