import { z } from "zod";
import { ConflictPropsSchema } from "./merged-review.schemas";
import { FindingPropsSchema, ReviewVerdictSchema } from "./review.schemas";

// ── Findings ──
export const FindingsUIContextSchema = z.object({
  sliceId: z.string().min(1),
  sliceLabel: z.string().min(1),
  verdict: ReviewVerdictSchema,
  findings: z.array(FindingPropsSchema),
  conflicts: z.array(ConflictPropsSchema),
  fixCyclesUsed: z.number().int().nonnegative(),
  timedOutReviewers: z.array(z.string()),
});
export type FindingsUIContext = z.infer<typeof FindingsUIContextSchema>;

export const FindingsUIResponseSchema = z.object({
  acknowledged: z.boolean(),
  formattedOutput: z.string().min(1),
});
export type FindingsUIResponse = z.infer<typeof FindingsUIResponseSchema>;

// ── Verification ──
export const VerificationUIContextSchema = z.object({
  sliceId: z.string().min(1),
  sliceLabel: z.string().min(1),
  criteria: z.array(
    z.object({
      criterion: z.string().min(1),
      verdict: z.enum(["PASS", "FAIL"]),
      evidence: z.string().min(1),
    }),
  ),
  overallVerdict: z.enum(["PASS", "FAIL"]),
});
export type VerificationUIContext = z.infer<typeof VerificationUIContextSchema>;

export const VerificationUIResponseSchema = z.object({
  accepted: z.boolean(),
  formattedOutput: z.string().min(1),
});
export type VerificationUIResponse = z.infer<typeof VerificationUIResponseSchema>;

// ── Approval ──
export const ApprovalUIContextSchema = z.object({
  sliceId: z.string().min(1),
  sliceLabel: z.string().min(1),
  artifactType: z.enum(["plan", "research", "spec", "verification"]),
  artifactPath: z.string().min(1),
  summary: z.string().min(1),
});
export type ApprovalUIContext = z.infer<typeof ApprovalUIContextSchema>;

export const ApprovalUIResponseSchema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]).optional(),
  feedback: z.string().optional(),
  formattedOutput: z.string().min(1),
});
export type ApprovalUIResponse = z.infer<typeof ApprovalUIResponseSchema>;
