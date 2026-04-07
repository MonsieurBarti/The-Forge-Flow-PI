import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";
import { FindingPropsSchema } from "./review.schemas";

export const AuditAgentTypeSchema = z.enum(["tff-spec-reviewer", "tff-security-auditor"]);
export type AuditAgentType = z.infer<typeof AuditAgentTypeSchema>;

export const AuditVerdictSchema = z.enum(["PASS", "FAIL"]);
export type AuditVerdict = z.infer<typeof AuditVerdictSchema>;

export const AuditReportSchema = z.object({
  agentType: AuditAgentTypeSchema,
  verdict: AuditVerdictSchema,
  findings: z.array(FindingPropsSchema),
  summary: z.string(),
});
export type AuditReportProps = z.infer<typeof AuditReportSchema>;

export const CompletionOutcomeSchema = z.enum(["merged", "abort"]);
export type CompletionOutcome = z.infer<typeof CompletionOutcomeSchema>;

export const CompletionRecordPropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  milestoneLabel: z.string().min(1),
  prNumber: z.number().int().positive(),
  prUrl: z.string().url(),
  headBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  auditReports: z.array(AuditReportSchema),
  outcome: CompletionOutcomeSchema.nullable(),
  fixCyclesUsed: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type CompletionRecordProps = z.infer<typeof CompletionRecordPropsSchema>;

export const CompleteMilestoneRequestSchema = z.object({
  milestoneId: z.string().min(1),
  milestoneLabel: z.string().min(1),
  milestoneTitle: z.string().min(1),
  headBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  workingDirectory: z.string().min(1),
  maxFixCycles: z.number().int().nonnegative().default(2),
});
export type CompleteMilestoneRequest = z.infer<typeof CompleteMilestoneRequestSchema>;

export const CompleteMilestoneResultSchema = z.object({
  milestoneId: z.string(),
  prNumber: z.number(),
  prUrl: z.string(),
  fixCyclesUsed: z.number(),
  merged: z.boolean(),
  auditReports: z.array(AuditReportSchema),
});
export type CompleteMilestoneResult = z.infer<typeof CompleteMilestoneResultSchema>;
