import { z } from "zod";

export const PreDispatchContextSchema = z.object({
  taskId: z.string(),
  sliceId: z.string(),
  milestoneId: z.string(),
  taskFilePaths: z.array(z.string()),
  sliceFilePaths: z.array(z.string()),
  worktreePath: z.string().optional(),
  expectedBranch: z.string(),
  agentModel: z.string(),
  agentTools: z.array(z.string()),
  upstreamTasks: z.array(z.object({ id: z.string(), status: z.string() })),
  budgetRemaining: z.number().optional(),
  budgetEstimated: z.number().optional(),
});
export type PreDispatchContext = z.infer<typeof PreDispatchContextSchema>;

export const PreDispatchViolationSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["blocker", "warning"]),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type PreDispatchViolation = z.infer<typeof PreDispatchViolationSchema>;

export const PreDispatchReportSchema = z.object({
  passed: z.boolean(),
  violations: z.array(PreDispatchViolationSchema),
  checkedAt: z.string().datetime(),
});
export type PreDispatchReport = z.infer<typeof PreDispatchReportSchema>;
