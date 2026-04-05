import { createZodTool, textResult } from "@infrastructure/pi";
import { z } from "zod";
import type { RemoveSliceUseCase } from "../../application/remove-slice.use-case";

export interface RemoveSliceToolDeps {
  removeSlice: RemoveSliceUseCase;
}

export function createRemoveSliceTool(deps: RemoveSliceToolDeps) {
  return createZodTool({
    name: "tff_remove_slice",
    label: "TFF Remove Slice",
    description: "Remove a future slice (discussing or researching only)",
    schema: z.object({
      sliceLabel: z.string().describe("Label of the slice to remove"),
    }),
    execute: async (params) => {
      const result = await deps.removeSlice.execute(params);
      if (!result.ok) return textResult(JSON.stringify({ error: result.error.message }));
      return textResult(JSON.stringify(result.data));
    },
  });
}
