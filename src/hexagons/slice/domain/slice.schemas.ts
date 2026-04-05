import type { ComplexityTier } from "@kernel";
import { ComplexityTierSchema, IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";
import { SliceKindSchema } from "./slice-kind.schemas";

export const SliceStatusSchema = z.enum([
  "discussing",
  "researching",
  "planning",
  "executing",
  "verifying",
  "reviewing",
  "completing",
  "closed",
]);
export type SliceStatus = z.infer<typeof SliceStatusSchema>;

export const SliceLabelSchema = z.string().regex(/^(M\d{2,}-S\d{2,}|Q-\d{2,}|D-\d{2,})$/);
export type SliceLabel = z.infer<typeof SliceLabelSchema>;

export const ArchitectureImpactSchema = z.enum(["none", "low", "high"]);
export type ArchitectureImpact = z.infer<typeof ArchitectureImpactSchema>;

export const RequirementClaritySchema = z.enum(["clear", "partial", "unclear"]);
export type RequirementClarity = z.infer<typeof RequirementClaritySchema>;

export const DomainScopeSchema = z.enum(["single", "dual", "multi"]);
export type DomainScope = z.infer<typeof DomainScopeSchema>;

export const ComplexityCriteriaSchema = z.object({
  architectureImpact: ArchitectureImpactSchema,
  requirementClarity: RequirementClaritySchema,
  domainScope: DomainScopeSchema,
});
export type ComplexityCriteria = z.infer<typeof ComplexityCriteriaSchema>;

export type { ComplexityTier } from "@kernel";
export type { SliceKind } from "./slice-kind.schemas";
export { ComplexityTierSchema, SliceKindSchema };

export function classifyComplexity(criteria: ComplexityCriteria): ComplexityTier {
  if (
    criteria.architectureImpact === "none" &&
    criteria.requirementClarity === "clear" &&
    criteria.domainScope === "single"
  ) {
    return "S";
  }
  if (
    criteria.architectureImpact === "high" ||
    criteria.requirementClarity === "unclear" ||
    criteria.domainScope === "multi"
  ) {
    return "F-full";
  }
  return "F-lite";
}

export const SlicePropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema.nullable().default(null),
  kind: SliceKindSchema.default("milestone"),
  label: SliceLabelSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: SliceStatusSchema,
  complexity: ComplexityTierSchema.nullable().default(null),
  specPath: z.string().nullable().default(null),
  planPath: z.string().nullable().default(null),
  researchPath: z.string().nullable().default(null),
  position: z.number().int().nonnegative().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type SliceProps = z.infer<typeof SlicePropsSchema>;
export type SliceDTO = SliceProps;
