import { IdSchema } from "@kernel";
import { z } from "zod";
import { MergedReviewPropsSchema } from "./merged-review.schemas";
import { ReviewPropsSchema, ReviewRoleSchema } from "./review.schemas";

export const ConductReviewRequestSchema = z.object({
  sliceId: IdSchema,
  workingDirectory: z.string().min(1),
  timeoutMs: z.number().int().positive().default(300_000),
  maxFixCycles: z.number().int().nonnegative().default(2),
});
export type ConductReviewRequest = z.infer<typeof ConductReviewRequestSchema>;

export const ConductReviewResultSchema = z.object({
  mergedReview: MergedReviewPropsSchema,
  individualReviews: z.array(ReviewPropsSchema),
  fixCyclesUsed: z.number().int().nonnegative(),
  timedOutReviewers: z.array(ReviewRoleSchema),
  retriedReviewers: z.array(ReviewRoleSchema),
});
export type ConductReviewResult = z.infer<typeof ConductReviewResultSchema>;
