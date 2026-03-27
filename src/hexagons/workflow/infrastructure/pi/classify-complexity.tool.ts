import { ComplexityTierSchema } from "@hexagons/slice";
import type { AgentToolResult } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import { isErr } from "@kernel";
import { z } from "zod";
import type { ClassifyComplexityUseCase } from "../../use-cases/classify-complexity.use-case";

const ClassifyComplexitySchema = z.object({
  sliceId: z.string().describe("Slice UUID"),
  tier: ComplexityTierSchema.describe("Complexity tier: S, F-lite, or F-full"),
});

export function createClassifyComplexityTool(useCase: ClassifyComplexityUseCase) {
  const textResult = (text: string): AgentToolResult => ({
    content: [{ type: "text", text }],
  });

  return createZodTool({
    name: "tff_classify_complexity",
    label: "TFF Classify Complexity",
    description: "Set the complexity tier for a slice after user confirmation.",
    schema: ClassifyComplexitySchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify(result.data));
    },
  });
}
