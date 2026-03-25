import { TimestampSchema } from "@kernel/schemas";
import { z } from "zod";

export const SyncReportSchema = z.object({
  pulled: z.number().int(),
  conflicts: z.array(z.string()),
  timestamp: TimestampSchema,
});
export type SyncReport = z.infer<typeof SyncReportSchema>;
