import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

import {
  FindingPropsSchema,
  ReviewRoleSchema,
  ReviewSeveritySchema,
  ReviewVerdictSchema,
} from "./review.schemas";

export const MergedFindingPropsSchema = FindingPropsSchema.extend({
  sourceReviewIds: z.array(IdSchema).min(1),
});
export type MergedFindingProps = z.infer<typeof MergedFindingPropsSchema>;

export const ConflictPropsSchema = z.object({
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  description: z.string().min(1),
  reviewerVerdicts: z
    .array(
      z.object({
        reviewId: IdSchema,
        role: ReviewRoleSchema,
        severity: ReviewSeveritySchema,
      }),
    )
    .min(2),
});
export type ConflictProps = z.infer<typeof ConflictPropsSchema>;

export const MergedReviewPropsSchema = z.object({
  sliceId: IdSchema,
  sourceReviewIds: z.array(IdSchema).min(1),
  verdict: ReviewVerdictSchema,
  findings: z.array(MergedFindingPropsSchema),
  conflicts: z.array(ConflictPropsSchema),
  mergedAt: TimestampSchema,
});
export type MergedReviewProps = z.infer<typeof MergedReviewPropsSchema>;
