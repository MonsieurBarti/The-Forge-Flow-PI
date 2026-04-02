import type { Result } from "@kernel";
import { z } from "zod";
import type { FixerError } from "../errors/fixer.error";
import { FindingPropsSchema } from "../review.schemas";

export const FixRequestSchema = z.object({
  sliceId: z.string().min(1),
  findings: z.array(FindingPropsSchema),
  workingDirectory: z.string().min(1),
});
export type FixRequest = z.infer<typeof FixRequestSchema>;

export const FixResultSchema = z.object({
  fixed: z.array(FindingPropsSchema),
  deferred: z.array(FindingPropsSchema),
  justifications: z.record(z.string(), z.string()).default({}),
  testsPassing: z.boolean(),
});
export type FixResult = z.infer<typeof FixResultSchema>;

export abstract class FixerPort {
  abstract fix(request: FixRequest): Promise<Result<FixResult, FixerError>>;
}
