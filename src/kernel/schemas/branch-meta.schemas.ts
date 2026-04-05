import { IdSchema, TimestampSchema } from "@kernel/schemas";
import { z } from "zod";

export const BranchMetaSchema = z.object({
  version: z.number().int().positive(),
  stateId: IdSchema,
  codeBranch: z.string().min(1),
  stateBranch: z.string().min(1),
  parentStateBranch: z.string().nullable(),
  lastSyncedAt: TimestampSchema.nullable(),
  lastJournalOffset: z.number().int().nonnegative().default(0),
  dirty: z.boolean().default(false),
  lastSyncedHash: z.string().nullable().default(null),
});
export type BranchMeta = z.infer<typeof BranchMetaSchema>;
