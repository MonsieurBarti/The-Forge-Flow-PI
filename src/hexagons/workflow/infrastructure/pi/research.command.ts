import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { ExtensionAPI } from "@infrastructure/pi";
import { isErr, isOk } from "@kernel";
import type { ArtifactFilePort } from "../../domain/ports/artifact-file.port";
import type { WorkflowSessionRepositoryPort } from "../../domain/ports/workflow-session.repository.port";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import { buildResearchProtocolMessage } from "./research-protocol";

export interface ResearchCommandDeps {
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  artifactFile: ArtifactFilePort;
  suggestNextStep: SuggestNextStepUseCase;
  withGuard?: () => Promise<void>;
}

export function registerResearchCommand(api: ExtensionAPI, deps: ResearchCommandDeps): void {
  api.registerCommand("tff:research", {
    description:
      "Start the research phase for a slice — explore the codebase and produce RESEARCH.md",
    handler: async (args: string, ctx) => {
      if (ctx?.newSession) await ctx.newSession();
      await deps.withGuard?.();
      // 1. Resolve target slice from args (label or ID)
      const identifier = args.trim();
      if (!identifier) {
        api.sendUserMessage("Usage: /tff:research <slice-label-or-id>");
        return;
      }

      // Try findByLabel first (e.g., "M03-S05"), fall back to findById (UUID)
      let sliceResult = await deps.sliceRepo.findByLabel(identifier);
      if (isErr(sliceResult)) {
        api.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
        return;
      }
      if (!sliceResult.data) {
        sliceResult = await deps.sliceRepo.findById(identifier);
        if (isErr(sliceResult)) {
          api.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
          return;
        }
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
        api.sendUserMessage("No workflow session found, run /tff:discuss first");
        return;
      }
      const session = sessionResult.data;

      // 4. Validate phase
      if (session.currentPhase !== "researching") {
        api.sendUserMessage("not researching, run /tff:discuss first");
        return;
      }

      // 5. Read SPEC.md
      const specResult = await deps.artifactFile.read(milestone.label, slice.label, "spec");
      if (isErr(specResult)) {
        api.sendUserMessage("Failed to read SPEC.md");
        return;
      }
      if (!specResult.data) {
        api.sendUserMessage("No SPEC.md found, run /tff:discuss first");
        return;
      }

      // 6. Get next-step suggestion
      const nextStepResult = await deps.suggestNextStep.execute({
        milestoneId: milestone.id,
      });
      const nextStep =
        isOk(nextStepResult) && nextStepResult.data ? nextStepResult.data.displayText : "";

      // 7. Send research protocol message
      api.sendUserMessage(
        buildResearchProtocolMessage({
          sliceId: slice.id,
          sliceLabel: slice.label,
          sliceTitle: slice.title,
          sliceDescription: slice.description,
          milestoneLabel: milestone.label,
          milestoneId: milestone.id,
          specContent: specResult.data,
          autonomyMode: session.autonomyMode,
          nextStep,
        }),
      );
    },
  });
}
