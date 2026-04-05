import type { PersistenceError, Result } from "@kernel";
import { TimestampSchema } from "@kernel";
import { z } from "zod";

export const WorkflowJournalEntrySchema = z.object({
  type: z.enum(["session-created", "phase-transition", "escalation"]),
  sessionId: z.string().min(1),
  milestoneId: z.string().min(1),
  sliceId: z.string().optional(),
  fromPhase: z.string().optional(),
  toPhase: z.string().optional(),
  trigger: z.string().optional(),
  timestamp: TimestampSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type WorkflowJournalEntry = z.infer<typeof WorkflowJournalEntrySchema>;

export abstract class WorkflowJournalPort {
  abstract append(entry: WorkflowJournalEntry): Promise<Result<void, PersistenceError>>;
  abstract readAll(): Promise<Result<WorkflowJournalEntry[], PersistenceError>>;
}
