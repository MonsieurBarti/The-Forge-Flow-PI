import { MilestoneLabelSchema } from "@hexagons/milestone";
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
        blockedBy: z.array(z.string()).default([]).describe("Labels of blocking tasks"),
      }),
    )
    .describe("Task definitions"),
});

export function createWritePlanTool(useCase: WritePlanUseCase) {
  return createZodTool({
    name: "tff_write_plan",
    label: "TFF Write Plan",
    description: "Write PLAN.md, create task entities with wave detection, update slice.",
    schema: WritePlanSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(
        JSON.stringify({
          ok: true,
          path: result.data.path,
          taskCount: result.data.taskCount,
          waveCount: result.data.waveCount,
        }),
      );
    },
  });
}
