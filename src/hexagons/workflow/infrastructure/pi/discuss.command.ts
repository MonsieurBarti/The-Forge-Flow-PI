import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import { isErr } from "@kernel";
import type { StartDiscussUseCase } from "../../use-cases/start-discuss.use-case";
import { buildDiscussProtocolMessage } from "./discuss-protocol";

export interface DiscussCommandDeps {
  startDiscuss: StartDiscussUseCase;
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
}

export function registerDiscussCommand(api: ExtensionAPI, deps: DiscussCommandDeps): void {
  api.registerCommand("tff:discuss", {
    description: "Start the discuss phase for a slice -- multi-turn Q&A producing SPEC.md",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // 1. Resolve target slice from args (label or ID)
      const identifier = args.trim();
      if (!identifier) {
        ctx.sendUserMessage("Usage: /tff:discuss <slice-label-or-id>");
        return;
      }

      // Try findByLabel first (e.g., "M03-S05"), fall back to findById (UUID)
      let sliceResult = await deps.sliceRepo.findByLabel(identifier);
      if (isErr(sliceResult)) {
        ctx.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
        return;
      }
      if (!sliceResult.data) {
        sliceResult = await deps.sliceRepo.findById(identifier);
        if (isErr(sliceResult)) {
          ctx.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
          return;
        }
      }
      const slice = sliceResult.data;
      if (!slice) {
        ctx.sendUserMessage(`Slice not found: ${identifier}`);
        return;
      }

      // 2. Load milestone
      const msResult = await deps.milestoneRepo.findById(slice.milestoneId);
      if (isErr(msResult)) {
        ctx.sendUserMessage(`Error loading milestone: ${msResult.error.message}`);
        return;
      }
      if (!msResult.data) {
        ctx.sendUserMessage(`Milestone not found for slice ${slice.label}`);
        return;
      }
      const milestone = msResult.data;

      // 3. Call StartDiscussUseCase
      const result = await deps.startDiscuss.execute({
        sliceId: slice.id,
        milestoneId: milestone.id,
      });

      if (isErr(result)) {
        ctx.sendUserMessage(`Error starting discuss: ${result.error.message}`);
        return;
      }

      // 4. Send protocol message
      const nextStep =
        result.data.autonomyMode === "plan-to-pr"
          ? "Invoke the next phase command automatically."
          : "Suggest the next step: `/tff:research` (if F-lite/F-full) or `/tff:plan` (if S-tier or research skipped).";

      ctx.sendUserMessage(
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
