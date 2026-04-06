import { MilestoneLabelSchema } from "@hexagons/milestone";
import type { ReviewUIPort } from "@hexagons/review";
import { SliceLabelSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { IdSchema, isErr } from "@kernel";
import { z } from "zod";
import type { WritePlanUseCase } from "../../use-cases/write-plan.use-case";

const WritePlanSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S07"),
  sliceId: IdSchema.describe("Slice UUID"),
  content: z.string().describe("Markdown plan content"),
  tasks: z
    .array(
      z.object({
        label: z.string().describe("Task label, e.g. T01"),
        title: z.string().describe("Task title"),
        description: z.string().describe("Task description with TDD steps"),
        acceptanceCriteria: z.string().describe("Joined AC refs, e.g. 'AC1, AC3'"),
        filePaths: z.array(z.string()).describe("Exact file paths"),
        blockedBy: z.array(z.string()).optional().describe("Labels of blocking tasks"),
      }),
    )
    .describe("Task definitions"),
});

export function createWritePlanTool(useCase: WritePlanUseCase, reviewUI: ReviewUIPort) {
  return createZodTool({
    name: "tff_write_plan",
    label: "TFF Write Plan",
    description: "Write PLAN.md, create task entities with wave detection, update slice.",
    schema: WritePlanSchema,
    execute: async (params) => {
      const withDefaults = {
        ...params,
        tasks: params.tasks.map((t) => ({ ...t, blockedBy: t.blockedBy ?? [] })),
      };
      const result = await useCase.execute(withDefaults);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);

      const approvalResult = await reviewUI.presentForApproval({
        sliceId: params.sliceId,
        sliceLabel: params.sliceLabel,
        artifactType: "plan",
        artifactPath: result.data.path,
        summary: `PLAN.md for ${params.sliceLabel} (${result.data.taskCount} tasks, ${result.data.waveCount} waves)`,
      });

      const approval = approvalResult.ok ? approvalResult.data : undefined;
      return textResult(
        JSON.stringify({
          ok: true,
          path: result.data.path,
          taskCount: result.data.taskCount,
          waveCount: result.data.waveCount,
          approval: approval
            ? {
                decision: approval.decision,
                feedback: approval.feedback,
                formattedOutput: approval.formattedOutput,
              }
            : undefined,
        }),
      );
    },
  });
}
