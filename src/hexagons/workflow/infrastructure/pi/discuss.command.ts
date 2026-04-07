import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { ProjectRepositoryPort } from "@hexagons/project";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { ExtensionAPI } from "@infrastructure/pi";
import { isErr, isOk } from "@kernel";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { StartDiscussUseCase } from "../../use-cases/start-discuss.use-case";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import { buildDiscussProtocolMessage } from "./discuss-protocol";
import { findSliceFuzzy, resolveNextSlice } from "./resolve-next-slice";

export interface DiscussCommandDeps {
  startDiscuss: StartDiscussUseCase;
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  suggestNextStep: SuggestNextStepUseCase;
  tffDir: string;
  withGuard?: () => Promise<void>;
}

export function registerDiscussCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: DiscussCommandDeps,
): void {
  dispatcher.register({
    name: "discuss",
    description: "Start the discuss phase for a slice -- multi-turn Q&A producing SPEC.md",
    handler: async (args: string, ctx) => {
      await deps.withGuard?.();

      // 1. Resolve target slice from args (label or ID), auto-detect if empty
      let identifier = args.trim();
      if (!identifier) {
        const next = await resolveNextSlice(
          "discussing",
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

      // 3. Start discuss (creates or reuses workflow session)
      const startResult = await deps.startDiscuss.execute({
        sliceId: slice.id,
        milestoneId: milestone.id,
        tffDir: deps.tffDir,
      });
      if (isErr(startResult)) {
        api.sendUserMessage(`Error starting discuss: ${startResult.error.message}`);
        return;
      }

      // 4. Read REQUIREMENTS.md for context
      let requirementsContent = "";
      try {
        const reqPath = join(deps.tffDir, "milestones", milestone.label, "REQUIREMENTS.md");
        requirementsContent = readFileSync(reqPath, "utf-8");
      } catch {
        // Requirements file may not exist yet — not fatal
      }

      // 5. Load sibling slices for scope context
      let slicesContext = "";
      const slicesResult = await deps.sliceRepo.findByMilestoneId(milestone.id);
      if (isOk(slicesResult) && slicesResult.data.length > 0) {
        const lines = slicesResult.data.map(
          (s) => `- ${s.label}: ${s.title} (${s.status})${s.id === slice.id ? " ← current" : ""}`,
        );
        slicesContext = lines.join("\n");
      }

      // 6. Get next-step suggestion
      const nextStepResult = await deps.suggestNextStep.execute({
        milestoneId: milestone.id,
      });
      const nextStep =
        isOk(nextStepResult) && nextStepResult.data ? nextStepResult.data.displayText : "";

      // 7. Send discuss protocol — inject into current session (no newSession)
      // GSD-2 pattern: manual commands never call newSession, only auto-loop does
      api.sendMessage(
        {
          customType: "tff-discuss",
          content: buildDiscussProtocolMessage({
            sliceId: slice.id,
            sliceLabel: slice.label,
            sliceTitle: slice.title,
            sliceDescription: slice.description,
            milestoneLabel: milestone.label,
            milestoneId: milestone.id,
            autonomyMode: startResult.data.autonomyMode,
            requirementsContent,
            slicesContext,
            nextStep,
          }),
          display: true,
        },
        { triggerTurn: true },
      );
    },
  });
}
