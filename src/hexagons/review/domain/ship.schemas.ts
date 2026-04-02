import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const MergeGateDecisionSchema = z.enum(["merged", "needs_changes", "abort"]);
export type MergeGateDecision = z.infer<typeof MergeGateDecisionSchema>;

export const ShipRecordPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  prNumber: z.number().int().positive(),
  prUrl: z.string().url(),
  headBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  outcome: MergeGateDecisionSchema.nullable(),
  fixCyclesUsed: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type ShipRecordProps = z.infer<typeof ShipRecordPropsSchema>;

export const ShipRequestSchema = z.object({
  sliceId: IdSchema,
  workingDirectory: z.string().min(1),
  baseBranch: z.string().min(1),
  headBranch: z.string().min(1),
  maxFixCycles: z.number().int().nonnegative().default(2),
});
export type ShipRequest = z.infer<typeof ShipRequestSchema>;

export const ShipResultSchema = z.object({
  sliceId: IdSchema,
  prNumber: z.number().int().positive(),
  prUrl: z.string().url(),
  fixCyclesUsed: z.number().int().nonnegative(),
  merged: z.boolean(),
});
export type ShipResult = z.infer<typeof ShipResultSchema>;
