import type { FailurePoliciesConfig } from "@hexagons/settings";
import { ComplexityTierSchema, type SliceRepositoryPort } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { isErr, isOk } from "@kernel";
import { z } from "zod";
import type { WorkflowSessionRepositoryPort } from "../../domain/ports/workflow-session.repository.port";
import { WorkflowTriggerSchema } from "../../domain/workflow-session.schemas";
import type { OrchestratePhaseTransitionUseCase } from "../../use-cases/orchestrate-phase-transition.use-case";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";

const WorkflowTransitionSchema = z.object({
  milestoneId: z.string().describe("Milestone ID (from tff_status output)"),
  trigger: WorkflowTriggerSchema.describe("Workflow trigger"),
  complexityTier: ComplexityTierSchema.optional().describe("Slice complexity tier if known"),
});

export interface WorkflowTransitionToolDeps {
  orchestratePhaseTransition: OrchestratePhaseTransitionUseCase;
  sessionRepo: WorkflowSessionRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  maxRetries: number;
  failurePolicies?: FailurePoliciesConfig;
  suggestNextStep: SuggestNextStepUseCase;
}

const PHASE_GUIDANCE: Record<string, string> = {
  executing:
    "CRITICAL: You MUST call tff_execute_slice to begin execution. " +
    "NEVER implement code manually — the tool auto-resolves the worktree path from sliceId. " +
    "Required params: sliceId, milestoneId, sliceLabel, sliceTitle, complexity, model, modelProfile.",
  researching:
    "Run /tff research to begin the research phase. Use tff_write_research to save findings.",
  planning:
    "Run /tff plan to begin planning. Use tff_write_plan to write PLAN.md — NEVER write files directly.",
  verifying: "Run /tff verify to validate acceptance criteria against the implementation.",
  reviewing: "Run /tff review to run code review.",
  shipping: "Run /tff ship to create a PR. NEVER merge or push directly.",
  idle: "Slice complete. Call tff_status for the next slice to work on, or /tff complete-milestone if all slices are closed.",
};

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

      const transitionData = result.data;
      const nsResult = await deps.suggestNextStep.execute({
        milestoneId: params.milestoneId,
      });
      const suggestion = isOk(nsResult) ? nsResult.data : null;
      const guidance = PHASE_GUIDANCE[transitionData.toPhase] ?? "";
      const suggestionText = suggestion ? ` ${suggestion.displayText}` : "";
      const nextSteps = guidance + suggestionText;

      return textResult(JSON.stringify({ ...transitionData, nextSteps }));
    },
  });
}
