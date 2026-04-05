import type { FailurePoliciesConfig } from "@hexagons/settings";
import { ComplexityTierSchema, type SliceRepositoryPort } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { isErr } from "@kernel";
import { z } from "zod";
import type { WorkflowSessionRepositoryPort } from "../../domain/ports/workflow-session.repository.port";
import { WorkflowTriggerSchema } from "../../domain/workflow-session.schemas";
import type { OrchestratePhaseTransitionUseCase } from "../../use-cases/orchestrate-phase-transition.use-case";

const WorkflowTransitionSchema = z.object({
  milestoneId: z.string().describe("Milestone UUID"),
  trigger: WorkflowTriggerSchema.describe("Workflow trigger"),
  complexityTier: ComplexityTierSchema.optional().describe("Slice complexity tier if known"),
});

export interface WorkflowTransitionToolDeps {
  orchestratePhaseTransition: OrchestratePhaseTransitionUseCase;
  sessionRepo: WorkflowSessionRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  maxRetries: number;
  failurePolicies?: FailurePoliciesConfig;
}

export function createWorkflowTransitionTool(deps: WorkflowTransitionToolDeps) {
  return createZodTool({
    name: "tff_workflow_transition",
    label: "TFF Workflow Transition",
    description: "Transition the workflow to the next phase. Constructs guard context internally.",
    schema: WorkflowTransitionSchema,
    execute: async (params) => {
      // 1. Load session
      const sessionResult = await deps.sessionRepo.findByMilestoneId(params.milestoneId);
      if (isErr(sessionResult)) return textResult(`Error: ${sessionResult.error.message}`);
      const session = sessionResult.data;
      if (!session) return textResult("Error: No workflow session found for milestone");

      // 2. Resolve complexity tier
      let complexityTier = params.complexityTier ?? null;
      if (!complexityTier && session.sliceId) {
        const sliceResult = await deps.sliceRepo.findById(session.sliceId);
        if (isErr(sliceResult)) return textResult(`Error: ${sliceResult.error.message}`);
        complexityTier = sliceResult.data?.complexity ?? null;
      }

      // 3. Compute allSlicesClosed
      const slicesResult = await deps.sliceRepo.findByMilestoneId(params.milestoneId);
      if (isErr(slicesResult)) return textResult(`Error: ${slicesResult.error.message}`);
      const allSlicesClosed = slicesResult.data.every((s) => s.status === "closed");

      // 4. Resolve failure policy from settings
      const currentPhase = session.currentPhase;
      const failurePolicy =
        deps.failurePolicies?.byPhase[currentPhase] ?? deps.failurePolicies?.default ?? "strict";

      // 5. Call use case with assembled guard context
      const result = await deps.orchestratePhaseTransition.execute({
        milestoneId: params.milestoneId,
        trigger: params.trigger,
        guardContext: {
          complexityTier,
          retryCount: session.retryCount,
          maxRetries: deps.maxRetries,
          allSlicesClosed,
          lastError: session.lastEscalation?.lastError ?? null,
          failurePolicy,
        },
      });

      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify(result.data));
    },
  });
}
