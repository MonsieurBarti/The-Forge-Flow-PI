import { z } from "zod";

export const AgentStatusSchema = z.enum(["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentConcernSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AgentConcernSeverity = z.infer<typeof AgentConcernSeveritySchema>;

export const AgentConcernSchema = z.object({
  area: z.string().min(1),
  description: z.string().min(1),
  severity: AgentConcernSeveritySchema,
});
export type AgentConcern = z.infer<typeof AgentConcernSchema>;

export const SelfReviewDimensionNameSchema = z.enum([
  "completeness",
  "quality",
  "discipline",
  "verification",
]);
export type SelfReviewDimensionName = z.infer<typeof SelfReviewDimensionNameSchema>;

export const SelfReviewDimensionSchema = z.object({
  dimension: SelfReviewDimensionNameSchema,
  passed: z.boolean(),
  note: z.string().optional(),
});
export type SelfReviewDimension = z.infer<typeof SelfReviewDimensionSchema>;

export const OverallConfidenceSchema = z.enum(["high", "medium", "low"]);
export type OverallConfidence = z.infer<typeof OverallConfidenceSchema>;

export const SelfReviewChecklistSchema = z.object({
  dimensions: z.array(SelfReviewDimensionSchema).length(4),
  overallConfidence: OverallConfidenceSchema,
});
export type SelfReviewChecklist = z.infer<typeof SelfReviewChecklistSchema>;

export const AgentStatusReportSchema = z.object({
  status: AgentStatusSchema,
  concerns: z.array(AgentConcernSchema).default([]),
  selfReview: SelfReviewChecklistSchema,
});
export type AgentStatusReport = z.infer<typeof AgentStatusReportSchema>;

export function isSuccessfulStatus(status: AgentStatus): boolean {
  return status === "DONE" || status === "DONE_WITH_CONCERNS";
}
