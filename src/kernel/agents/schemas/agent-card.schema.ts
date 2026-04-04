import { ModelProfileNameSchema } from "@kernel/schemas";
import { z } from "zod";

export const AgentTypeSchema = z.enum([
  "spec-reviewer",
  "code-reviewer",
  "security-auditor",
  "fixer",
  "executor",
  "verifier",
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentCapabilitySchema = z.enum(["review", "fix", "execute", "verify"]);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const FreshReviewerRuleSchema = z.enum(["must-not-be-executor", "none"]);
export type FreshReviewerRule = z.infer<typeof FreshReviewerRuleSchema>;

export const AgentScopeSchema = z.enum(["slice", "task"]);
export type AgentScope = z.infer<typeof AgentScopeSchema>;

export const ReviewStrategySchema = z.enum(["standard", "critique-then-reflection"]);

export const AgentSkillSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  strategy: ReviewStrategySchema,
});
export type AgentSkill = z.infer<typeof AgentSkillSchema>;

export const AgentCardSchema = z.object({
  type: AgentTypeSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  identity: z.string().min(1),
  purpose: z.string().min(1),
  scope: AgentScopeSchema,
  freshReviewerRule: FreshReviewerRuleSchema,
  capabilities: z.array(AgentCapabilitySchema).min(1),
  defaultModelProfile: ModelProfileNameSchema,
  skills: z.array(AgentSkillSchema).min(1),
  requiredTools: z.array(z.string()),
  optionalTools: z.array(z.string()).default([]),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
