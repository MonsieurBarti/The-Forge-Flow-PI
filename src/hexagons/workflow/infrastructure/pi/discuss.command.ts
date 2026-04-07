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
}

export function registerDiscussCommand(api: ExtensionAPI, deps: DiscussCommandDeps): void {
  api.registerCommand("tff:discuss", {
    description: "Start the discuss phase for a slice -- multi-turn Q&A producing SPEC.md",
    handler: async (args, _ctx) => {
      await deps.withGuard?.();
      api.sendUserMessage(
        [
          "## Discuss & Design Workflow",
          "",
          "Follow these phases IN ORDER. The key principle: YOU do the thinking, the user confirms.",
          "",
          "**Phase 1 — Scope (propose, don't ask)**",
          "First read REQUIREMENTS.md to understand the context.",
          "Then for each topic, PROPOSE a concrete answer and ask the user to confirm.",
          "Ask ONE topic per message. Wait for the user before proceeding.",
          "",
          "Example of a GOOD question:",
          '> "Based on REQUIREMENTS.md, this slice solves multi-tenant event isolation.',
          "> I propose these acceptance criteria:",
          "> - AC1: Events are scoped to organization via tenant ID",
          "> - AC2: Cross-tenant queries return empty results",
          "> - AC3: Tenant context is validated at the API boundary",
          '> Does this cover it, or should I adjust?"',
          "",
          "Example of a BAD question:",
          '> "What are the acceptance criteria for this slice?"',
          "",
          "Topics to cover (one per message):",
          "1. Problem & scope → propose what this slice solves based on requirements",
          "2. Acceptance criteria → propose concrete, testable ACs",
          "3. Constraints & dependencies → propose known constraints",
          "4. Unknowns → propose areas that need investigation",
          "",
          "**Phase 2 — Approach**",
          "Propose 2-3 implementation approaches with trade-offs.",
          "Recommend one and explain why. Ask the user to pick.",
          "",
          "**Phase 3 — Write spec**",
          "Write the COMPLETE spec based on the discussion.",
          "Do NOT ask for section-by-section approval — write the full spec at once.",
          "Call `tff_write_spec` with the complete content.",
          "Plannotator will open automatically for the user to review.",
          "",
          "**Phase 4 — Classify and transition**",
          "Call `tff_classify_complexity` to determine the tier.",
          "Then call `tff_workflow_transition` to move to the next phase.",
          "Suggest `/tff:research` (F-lite/F-full) or `/tff:plan` (S-tier).",
        ].join("\n"),
      );
    },
  });
}
