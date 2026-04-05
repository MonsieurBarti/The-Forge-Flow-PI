import { z } from "zod";

export const RenameDetectionResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("match") }),
  z.object({ kind: z.literal("switch") }),
  z.object({ kind: z.literal("rename"), newBranch: z.string() }),
  z.object({ kind: z.literal("untracked") }),
]);
export type RenameDetectionResult = z.infer<typeof RenameDetectionResultSchema>;
