import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";
import { AuditReportSchema } from "./completion.schemas";

export const MilestoneAuditRecordPropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  milestoneLabel: z.string().min(1),
  auditReports: z.array(AuditReportSchema),
  allPassed: z.boolean(),
  unresolvedCount: z.number().int().nonnegative(),
  auditedAt: TimestampSchema,
});
export type MilestoneAuditRecordProps = z.infer<typeof MilestoneAuditRecordPropsSchema>;
