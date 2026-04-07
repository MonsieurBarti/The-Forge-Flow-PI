import { MilestoneLabelSchema } from "@hexagons/milestone";
import type { ReviewUIPort } from "@hexagons/review";
import { SliceLabelSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { IdSchema, isErr } from "@kernel";
import { z } from "zod";
import type { WriteSpecUseCase } from "../../use-cases/write-spec.use-case";

const WriteSpecSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S05"),
  sliceId: IdSchema.describe("Slice ID (from tff_status output)"),
  content: z.string().describe("Markdown spec content"),
});

export function createWriteSpecTool(useCase: WriteSpecUseCase, reviewUI: ReviewUIPort) {
  return createZodTool({
    name: "tff_write_spec",
    label: "TFF Write Spec",
    description:
      "Write SPEC.md for a slice and update the slice aggregate. Output path: .tff/milestones/{milestoneLabel}/slices/{sliceLabel}/SPEC.md",
    schema: WriteSpecSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);

      const approvalResult = await reviewUI.presentForApproval({
        sliceId: params.sliceId,
        sliceLabel: params.sliceLabel,
        artifactType: "spec",
        artifactPath: result.data.path,
        summary: `SPEC.md for ${params.sliceLabel}`,
      });

      const approval = approvalResult.ok ? approvalResult.data : undefined;
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
          nextSteps:
            "IMPORTANT: After user approves the spec, you MUST: 1) Propose complexity tier (S/F-lite/F-full) and get user confirmation, 2) Call tff_classify_complexity, 3) Call tff_workflow_transition with trigger='next' (or 'skip' for S-tier)",
        }),
      );
    },
  });
}
