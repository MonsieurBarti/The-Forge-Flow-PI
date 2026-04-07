import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const ReviewSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewVerdictSchema = z.enum(["approved", "changes_requested", "rejected"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const ReviewRoleSchema = z.enum([
  "tff-code-reviewer",
  "tff-spec-reviewer",
  "tff-security-auditor",
]);
export type ReviewRole = z.infer<typeof ReviewRoleSchema>;

export const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const FindingImpactSchema = z.enum(["must-fix", "should-fix", "nice-to-have"]);
export type FindingImpact = z.infer<typeof FindingImpactSchema>;

export const ReviewStrategySchema = z.enum(["standard", "critique-then-reflection"]);
export type ReviewStrategy = z.infer<typeof ReviewStrategySchema>;

export const FindingPropsSchema = z.object({
  id: IdSchema,
  severity: ReviewSeveritySchema,
  message: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().optional(),
  suggestion: z.string().optional(),
  ruleId: z.string().optional(),
  impact: FindingImpactSchema.optional(),
});
export type FindingProps = z.infer<typeof FindingPropsSchema>;

export const ReviewPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  role: ReviewRoleSchema,
  agentIdentity: z.string().min(1),
  verdict: ReviewVerdictSchema,
  findings: z.array(FindingPropsSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ReviewProps = z.infer<typeof ReviewPropsSchema>;
