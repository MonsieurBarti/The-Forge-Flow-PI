import type { ReviewUIPort } from "@hexagons/review";
import type { ExtensionAPI } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import type { CreateMilestoneUseCase } from "../../use-cases/create-milestone.use-case";
import { CreateMilestoneParamsSchema } from "../../use-cases/create-milestone.use-case";

export interface MilestoneExtensionDeps {
  createMilestone: CreateMilestoneUseCase;
  reviewUI: ReviewUIPort;
  loadPrompt: (path: string) => string;
}

export function registerMilestoneExtension(api: ExtensionAPI, deps: MilestoneExtensionDeps): void {
  api.registerCommand("tff:new-milestone", {
    description: "Create a new milestone for the current project",
    handler: async (_args, _ctx) => {
      api.sendUserMessage(deps.loadPrompt("prompts/new-milestone-workflow.md"));
    },
  });

  api.registerTool(
    createZodTool({
      name: "tff_create_milestone",
      label: "The Forge Flow — Create Milestone",
      description:
        "Create and activate a new The Forge Flow (TFF) milestone with requirements. IMPORTANT: You MUST gather requirements from the user via discussion BEFORE calling this tool. The requirements param should contain the validated requirements from that discussion. Auto-assigns the next label (M01, M02, ...).",
      schema: CreateMilestoneParamsSchema,
      execute: async (params) => {
        const result = await deps.createMilestone.execute(params);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Failed: ${result.error.message}` }],
            details: undefined,
          };
        }
        // Trigger plannotator review on REQUIREMENTS.md
        const approvalResult = await deps.reviewUI.presentForApproval({
          sliceId: result.data.milestoneId,
          sliceLabel: result.data.label,
          artifactType: "spec",
          artifactPath: result.data.requirementsPath,
          summary: `REQUIREMENTS.md for ${result.data.label}`,
        });
        const approval = approvalResult.ok ? approvalResult.data : undefined;

        return {
          content: [
            {
              type: "text",
              text: [
                `Milestone **${result.data.label}** ("${params.title}") created and activated.`,
                "",
                `milestoneId: ${result.data.milestoneId}`,
                approval
                  ? `\nRequirements review: ${approval.decision}${approval.feedback ? ` — ${approval.feedback}` : ""}`
                  : "",
                "",
                "## Next steps",
                "1. Propose a breakdown into 3-8 slices (each a coherent unit of work)",
                "2. After user approval, create each slice with `tff_add_slice` using milestoneId above",
                "3. Give each slice a descriptive title (NOT the label — labels are auto-assigned)",
                "4. When all slices are created, suggest `/tff:discuss` to begin scoping the first slice",
              ].join("\n"),
            },
          ],
          details: undefined,
        };
      },
    }),
  );
}
