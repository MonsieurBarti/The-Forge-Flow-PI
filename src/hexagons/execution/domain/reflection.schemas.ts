import { z } from "zod";

export const ReflectionIssueSchema = z.object({
  severity: z.enum(["blocker", "warning"]),
  description: z.string().min(1),
  filePath: z.string().optional(),
});
export type ReflectionIssue = z.infer<typeof ReflectionIssueSchema>;

export const ReflectionResultSchema = z.object({
  passed: z.boolean(),
  tier: z.enum(["fast", "full"]),
  issues: z.array(ReflectionIssueSchema).default([]),
  reflectedAt: z.string().datetime(),
});
export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;
