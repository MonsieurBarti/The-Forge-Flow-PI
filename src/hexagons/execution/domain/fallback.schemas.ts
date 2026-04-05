import { z } from "zod";

export const FallbackStrategySchema = z.object({
  retryCount: z.number().int().min(0).max(3).default(1),
  downshiftChain: z.array(z.string()).default(["quality", "balanced", "budget"]),
  checkpointBeforeRetry: z.boolean().default(true),
});
export type FallbackStrategy = z.infer<typeof FallbackStrategySchema>;

export const ModelResolutionSchema = z.object({
  action: z.enum(["retry", "downshift", "escalate"]),
  profile: z.string().min(1),
  attempt: z.number().int().nonnegative(),
});
export type ModelResolution = z.infer<typeof ModelResolutionSchema>;
