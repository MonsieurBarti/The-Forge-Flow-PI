import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { ExtensionAPI } from "@infrastructure/pi";
import { isErr, isOk } from "@kernel";
import type { StartDiscussUseCase } from "../../use-cases/start-discuss.use-case";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import { buildDiscussProtocolMessage } from "./discuss-protocol";

export interface DiscussCommandDeps {
  startDiscuss: StartDiscussUseCase;
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  suggestNextStep: SuggestNextStepUseCase;
}

export function registerDiscussCommand(api: ExtensionAPI, deps: DiscussCommandDeps): void {
  api.registerCommand("tff:discuss", {
    description: "Start the discuss phase for a slice -- multi-turn Q&A producing SPEC.md",
    handler: async (args: string) => {
      // 1. Resolve target slice from args (label or ID)
      const identifier = args.trim();
      if (!identifier) {
        api.sendUserMessage("Usage: /tff:discuss <slice-label-or-id>");
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

      // 3. Call StartDiscussUseCase
      const result = await deps.startDiscuss.execute({
        sliceId: slice.id,
        milestoneId: milestone.id,
        tffDir: "", // Resolved by extension wiring
      });

      if (isErr(result)) {
        api.sendUserMessage(`Error starting discuss: ${result.error.message}`);
        return;
      }

      // 4. Get next-step suggestion
      const nextStepResult = await deps.suggestNextStep.execute({
        milestoneId: milestone.id,
      });
      const nextStep =
        isOk(nextStepResult) && nextStepResult.data ? nextStepResult.data.displayText : "";

      // 5. Send protocol message
      api.sendUserMessage(
        buildDiscussProtocolMessage({
          sliceId: slice.id,
          sliceLabel: slice.label,
          sliceTitle: slice.title,
          sliceDescription: slice.description,
          milestoneLabel: milestone.label,
          milestoneId: milestone.id,
          autonomyMode: result.data.autonomyMode,
          nextStep,
        }),
      );
    },
  });
}
