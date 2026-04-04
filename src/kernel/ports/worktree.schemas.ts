import { z } from "zod";

export const WorktreeInfoSchema = z.object({
  sliceId: z.string().min(1),
  branch: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().min(1),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>;

export const WorktreeHealthSchema = z.object({
  sliceId: z.string().min(1),
  exists: z.boolean(),
  branchValid: z.boolean(),
  clean: z.boolean(),
  reachable: z.boolean(),
});
export type WorktreeHealth = z.infer<typeof WorktreeHealthSchema>;

export const CleanupReportSchema = z.object({
  deleted: z.array(z.string()),
  skipped: z.array(z.string()),
  errors: z.array(z.object({ sliceId: z.string(), reason: z.string() })),
});
export type CleanupReport = z.infer<typeof CleanupReportSchema>;
