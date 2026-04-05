import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const CriterionVerdictSchema = z.object({
  criterion: z.string().min(1),
  verdict: z.enum(["PASS", "FAIL"]),
  evidence: z.string().min(1),
});
export type CriterionVerdictProps = z.infer<typeof CriterionVerdictSchema>;

export const VerificationVerdictSchema = z.enum(["PASS", "FAIL"]);
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;

export const VerificationPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  agentIdentity: z.string().min(1),
  criteria: z.array(CriterionVerdictSchema),
  overallVerdict: VerificationVerdictSchema,
  fixCycleIndex: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
});
export type VerificationProps = z.infer<typeof VerificationPropsSchema>;

export const VerifyRequestSchema = z.object({
  sliceId: IdSchema,
  workingDirectory: z.string().min(1),
  timeoutMs: z.number().int().positive().default(300_000),
  maxFixCycles: z.number().int().nonnegative().default(2),
});
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

export const VerifyResultSchema = z.object({
  sliceId: IdSchema,
  verifications: z.array(VerificationPropsSchema),
  finalVerdict: VerificationVerdictSchema,
  fixCyclesUsed: z.number().int().nonnegative(),
  retriedVerification: z.boolean(),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;
