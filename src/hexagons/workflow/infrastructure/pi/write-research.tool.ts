import { MilestoneLabelSchema } from "@hexagons/milestone";
import type { ReviewUIPort } from "@hexagons/review";
import { SliceLabelSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { IdSchema, isErr } from "@kernel";
import { z } from "zod";
import type { WriteResearchUseCase } from "../../use-cases/write-research.use-case";

const WriteResearchSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S06"),
  sliceId: IdSchema.describe("Slice ID (from tff_status output)"),
  content: z.string().describe("Markdown research content"),
});

export function createWriteResearchTool(useCase: WriteResearchUseCase, reviewUI: ReviewUIPort) {
  return createZodTool({
    name: "tff_write_research",
    label: "TFF Write Research",
    description:
      "Write RESEARCH.md for a slice and update the slice aggregate. Output path: .tff/milestones/{milestoneLabel}/slices/{sliceLabel}/RESEARCH.md",
    schema: WriteResearchSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);

      const approvalResult = await reviewUI.presentForApproval({
        sliceId: params.sliceId,
        sliceLabel: params.sliceLabel,
        artifactType: "research",
        artifactPath: result.data.path,
        summary: `RESEARCH.md for ${params.sliceLabel}`,
      });

      const approval = approvalResult.ok ? approvalResult.data : undefined;
      const approved = approval?.decision === "approved";
      return textResult(
        JSON.stringify({
          ok: true,
          path: result.data.path,
          approval: approval
            ? {
                decision: approval.decision,
                feedback: approval.feedback,
                formattedOutput: approval.formattedOutput,
              }
            : undefined,
          nextSteps: approved
            ? "Plannotator APPROVED the research. If the feedback contains minor comments or suggestions, address them briefly inline but do NOT re-ask the user for approval. Proceed directly: call tff_workflow_transition with trigger='next' to advance to the planning phase."
            : "Plannotator REQUESTED CHANGES. Show the feedback to the user, revise the research accordingly, then call tff_write_research again with the revised content.",
        }),
      );
    },
  });
}
