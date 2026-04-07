import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { ProjectRepositoryPort } from "@hexagons/project";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { ExtensionAPI } from "@infrastructure/pi";
import { isErr, isOk } from "@kernel";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { ArtifactFilePort } from "../../domain/ports/artifact-file.port";
import type { WorkflowSessionRepositoryPort } from "../../domain/ports/workflow-session.repository.port";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import { buildPlanProtocolMessage } from "./plan-protocol";
import { findSliceFuzzy, resolveNextSlice } from "./resolve-next-slice";

export interface PlanCommandDeps {
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  artifactFile: ArtifactFilePort;
  suggestNextStep: SuggestNextStepUseCase;
  withGuard?: () => Promise<void>;
}

export function registerPlanCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: PlanCommandDeps,
): void {
  dispatcher.register({
    name: "plan",
    description: "Start the planning phase — decompose spec into tasks with wave detection",
    handler: async (args: string, ctx) => {
      await deps.withGuard?.();
      // 1. Resolve target slice from args (label or ID), auto-detect if empty
      let identifier = args.trim();
      if (!identifier) {
        const next = await resolveNextSlice(
          "planning",
          deps.projectRepo,
          deps.milestoneRepo,
          deps.sliceRepo,
        );
        if (typeof next === "string") {
          api.sendUserMessage(next);
          return;
        }
        identifier = next.sliceLabel;
      }

      // Find slice with fuzzy matching (exact label -> ID -> suffix match)
      const sliceResult = await findSliceFuzzy(
        identifier,
        deps.sliceRepo,
        deps.milestoneRepo,
        deps.projectRepo,
      );
      if (isErr(sliceResult)) {
        api.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
        return;
      }
      const slice = sliceResult.data;
      if (!slice) {
        api.sendUserMessage(`Slice not found: ${identifier}`);
        return;
      }
      if (!slice.milestoneId) {
        api.sendUserMessage("Error: ad-hoc slices don't use this command");
        return;
      }

      // 2. Load milestone
      const msResult = await deps.milestoneRepo.findById(slice.milestoneId);
      if (isErr(msResult)) {
        api.sendUserMessage(`Error loading milestone: ${msResult.error.message}`);
        return;
      }
      if (!msResult.data) {
        api.sendUserMessage(`Milestone not found for slice ${slice.label}`);
        return;
      }
      const milestone = msResult.data;

      // 3. Load workflow session
      const sessionResult = await deps.sessionRepo.findByMilestoneId(milestone.id);
      if (isErr(sessionResult)) {
        api.sendUserMessage(`Error loading workflow session: ${sessionResult.error.message}`);
        return;
      }
      if (!sessionResult.data) {
        api.sendUserMessage("No workflow session found. Run /tff discuss first.");
        return;
      }
      const session = sessionResult.data;

      // 4. Validate phase
      if (session.currentPhase !== "planning") {
        api.sendUserMessage(
          `Cannot start plan: slice is in "${session.currentPhase}" phase, not "planning".\n\n` +
            `Current workflow phase: **${session.currentPhase}**\n` +
            `To advance to planning, complete the current phase first:\n` +
            `- If discussing: finish the discussion, classify complexity, then call \`tff_workflow_transition\` with trigger "next"\n` +
            `- If researching: complete research, then call \`tff_workflow_transition\` with trigger "next"`,
        );
        return;
      }

      // 5. Read SPEC.md
      const specResult = await deps.artifactFile.read(milestone.label, slice.label, "spec");
      if (isErr(specResult)) {
        api.sendUserMessage("Failed to read SPEC.md");
        return;
      }
      if (!specResult.data) {
        api.sendUserMessage("No SPEC.md found. Run /tff discuss first.");
        return;
      }

      // 6. Read RESEARCH.md (optional)
      let researchContent: string | null = null;
      const researchResult = await deps.artifactFile.read(milestone.label, slice.label, "research");
      if (isOk(researchResult) && researchResult.data) {
        researchContent = researchResult.data;
      }

      // 7. Get next-step suggestion
      const nextStepResult = await deps.suggestNextStep.execute({
        milestoneId: milestone.id,
      });
      const nextStep =
        isOk(nextStepResult) && nextStepResult.data ? nextStepResult.data.displayText : "";

      // 8. Clear session and send plan protocol message
      if (ctx?.newSession) {
        const switchResult = await ctx.newSession();
        if (switchResult?.cancelled) {
          api.sendUserMessage("Session switch was cancelled. Run /tff plan again.");
          return;
        }
      }
      api.sendUserMessage(
        buildPlanProtocolMessage({
          sliceId: slice.id,
          sliceLabel: slice.label,
          sliceTitle: slice.title,
          sliceDescription: slice.description,
          milestoneLabel: milestone.label,
          milestoneId: milestone.id,
          specContent: specResult.data,
          researchContent,
          autonomyMode: session.autonomyMode,
          nextStep,
        }),
      );
    },
  });
}
