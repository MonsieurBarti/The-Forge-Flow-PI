import type { ReviewUIPort } from "@hexagons/review";
import type { ExtensionAPI } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import type { CreateMilestoneUseCase } from "../../use-cases/create-milestone.use-case";
import { CreateMilestoneParamsSchema } from "../../use-cases/create-milestone.use-case";

export interface MilestoneExtensionDeps {
  createMilestone: CreateMilestoneUseCase;
  reviewUI: ReviewUIPort;
}

export function registerMilestoneExtension(api: ExtensionAPI, deps: MilestoneExtensionDeps): void {
  api.registerCommand("tff:new-milestone", {
    description: "Create a new milestone for the current project",
    handler: async (_args, _ctx) => {
      api.sendUserMessage(
        [
          "## New Milestone Workflow",
          "",
          "IMPORTANT: Follow these steps IN ORDER. Do NOT skip ahead.",
          "",
          "**Step 1 — Milestone scope**",
          "Ask the user: What is this milestone about? What's the goal?",
          "Discuss until the scope is clear. Propose a milestone title.",
          "",
          "**Step 2 — Requirements gathering**",
          "Ask the user to describe the requirements for this milestone.",
          "For each requirement, discuss:",
          "- What problem does it solve?",
          "- What are the acceptance criteria?",
          "- What are the constraints?",
          "Compile the requirements into a clear document.",
          "",
          "**Step 3 — Create milestone**",
          "Once requirements are gathered and confirmed by the user,",
          "call `tff_create_milestone` with the title, description, AND the compiled requirements.",
          "Do NOT call this tool before discussing requirements with the user.",
          "",
          "**Step 4 — Slice decomposition**",
          "Propose how to break the milestone into 3-8 slices.",
          "Each slice should be a coherent, reviewable unit of work.",
          "Present as a numbered list with title and brief description.",
          "Ask the user to approve, adjust, or add/remove slices.",
          "",
          "**Step 5 — Create slices**",
          "Only after the user approves the breakdown:",
          "Call `tff_add_slice` for each approved slice using the milestoneId from step 3.",
          "Use descriptive titles (e.g., 'Authentication & JWT Setup'), NOT labels.",
          "",
          "**Step 6 — Summary and next**",
          "Show the milestone structure and suggest `/tff:discuss` to begin scoping the first slice.",
        ].join("\n"),
      );
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
