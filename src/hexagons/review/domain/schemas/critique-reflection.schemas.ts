import { IdSchema } from "@kernel";
import { z } from "zod";
import { FindingImpactSchema, FindingPropsSchema } from "./review.schemas";

export const CritiquePassResultSchema = z.object({
  rawFindings: z.array(FindingPropsSchema),
});
export type CritiquePassResult = z.infer<typeof CritiquePassResultSchema>;

export const ReflectionInsightSchema = z.object({
  theme: z.string().min(1),
  affectedFindings: z.array(IdSchema),
  recommendation: z.string().min(1),
});
export type ReflectionInsight = z.infer<typeof ReflectionInsightSchema>;

const FindingWithImpactSchema = FindingPropsSchema.extend({ impact: FindingImpactSchema });

export const ReflectionPassResultSchema = z.object({
  prioritizedFindings: z.array(FindingWithImpactSchema),
  insights: z.array(ReflectionInsightSchema),
  summary: z.string().min(1),
});
export type ReflectionPassResult = z.infer<typeof ReflectionPassResultSchema>;

export const CritiqueReflectionResultSchema = z.object({
  critique: CritiquePassResultSchema,
  reflection: ReflectionPassResultSchema,
});
export type CritiqueReflectionResult = z.infer<typeof CritiqueReflectionResultSchema>;

export const ProcessedReviewResultSchema = z.object({
  findings: z.array(FindingWithImpactSchema),
  insights: z.array(ReflectionInsightSchema),
  summary: z.string().min(1),
});
export type ProcessedReviewResult = z.infer<typeof ProcessedReviewResultSchema>;
