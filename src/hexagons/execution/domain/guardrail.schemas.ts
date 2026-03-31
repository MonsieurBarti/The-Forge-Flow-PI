import { AgentResultSchema } from "@kernel/agents";
import { z } from "zod";

export const GuardrailRuleIdSchema = z.enum([
  "dangerous-commands",
  "credential-exposure",
  "destructive-git",
  "file-scope",
  "suspicious-content",
]);
export type GuardrailRuleId = z.infer<typeof GuardrailRuleIdSchema>;

export const GuardrailSeveritySchema = z.enum(["error", "warning", "info"]);
export type GuardrailSeverity = z.infer<typeof GuardrailSeveritySchema>;

export const GuardrailViolationSchema = z.object({
  ruleId: GuardrailRuleIdSchema,
  severity: GuardrailSeveritySchema,
  filePath: z.string().optional(),
  pattern: z.string().optional(),
  message: z.string().min(1),
  line: z.number().int().min(1).optional(),
});
export type GuardrailViolation = z.infer<typeof GuardrailViolationSchema>;

export const GuardrailValidationReportSchema = z.object({
  violations: z.array(GuardrailViolationSchema),
  passed: z.boolean(),
  summary: z.string(),
});
export type GuardrailValidationReport = z.infer<typeof GuardrailValidationReportSchema>;

export const GuardrailContextSchema = z.object({
  agentResult: AgentResultSchema,
  taskFilePaths: z.array(z.string()),
  workingDirectory: z.string().min(1),
  filesChanged: z.array(z.string()),
});
export type GuardrailContext = z.infer<typeof GuardrailContextSchema>;
