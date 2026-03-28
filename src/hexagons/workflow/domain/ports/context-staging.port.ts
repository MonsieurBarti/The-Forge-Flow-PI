import { ComplexityTierSchema, IdSchema, type Result } from "@kernel";
import { z } from "zod";
import type { ContextPackage } from "../context-package.value-object";
import type { ContextStagingError } from "../errors/context-staging.error";
import { WorkflowPhaseSchema } from "../workflow-session.schemas";

export const ContextStagingRequestSchema = z.object({
  phase: WorkflowPhaseSchema,
  sliceId: IdSchema,
  taskId: IdSchema.optional(),
  complexity: ComplexityTierSchema,
  filePaths: z.array(z.string()),
  taskDescription: z.string(),
  acceptanceCriteria: z.array(z.string()),
});
export type ContextStagingRequest = z.infer<typeof ContextStagingRequestSchema>;

export abstract class ContextStagingPort {
  abstract stage(
    request: ContextStagingRequest,
  ): Promise<Result<ContextPackage, ContextStagingError>>;
}
