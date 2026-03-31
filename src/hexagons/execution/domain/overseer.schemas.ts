import { ComplexityTierSchema, IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const OverseerVerdictSchema = z.object({
  strategy: z.string().min(1),
  reason: z.string().min(1),
});
export type OverseerVerdict = z.infer<typeof OverseerVerdictSchema>;

export const OverseerContextSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  complexityTier: ComplexityTierSchema,
  dispatchTimestamp: TimestampSchema,
});
export type OverseerContext = z.infer<typeof OverseerContextSchema>;

export const OverseerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeouts: z
    .object({
      S: z.number().int().positive().default(300000),
      "F-lite": z.number().int().positive().default(900000),
      "F-full": z.number().int().positive().default(1800000),
    })
    .default({ S: 300000, "F-lite": 900000, "F-full": 1800000 }),
  retryLoop: z
    .object({
      threshold: z.number().int().min(1).default(3),
    })
    .default({ threshold: 3 }),
});
export type OverseerConfig = z.infer<typeof OverseerConfigSchema>;

export const RetryDecisionSchema = z.object({
  retry: z.boolean(),
  reason: z.string().min(1),
});
export type RetryDecision = z.infer<typeof RetryDecisionSchema>;

export const InterventionActionSchema = z.enum(["aborted", "retrying", "escalated"]);
export type InterventionAction = z.infer<typeof InterventionActionSchema>;
