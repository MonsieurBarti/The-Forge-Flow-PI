import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { ExtensionAPI } from "@infrastructure/pi";
import type { StartDiscussUseCase } from "../../use-cases/start-discuss.use-case";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";

export interface DiscussCommandDeps {
  startDiscuss: StartDiscussUseCase;
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  suggestNextStep: SuggestNextStepUseCase;
  withGuard?: () => Promise<void>;
  loadPrompt: (path: string) => string;
}

export function registerDiscussCommand(api: ExtensionAPI, deps: DiscussCommandDeps): void {
  api.registerCommand("tff:discuss", {
    description: "Start the discuss phase for a slice -- multi-turn Q&A producing SPEC.md",
    handler: async (_args, _ctx) => {
      await deps.withGuard?.();
      api.sendUserMessage(deps.loadPrompt("prompts/discuss-workflow.md"));
    },
  });
}
