import { IdSchema, TimestampSchema } from "@kernel/schemas";
import { ProjectPropsSchema } from "@hexagons/project/domain/project.schemas";
import { MilestonePropsSchema } from "@hexagons/milestone/domain/milestone.schemas";
import { SlicePropsSchema } from "@hexagons/slice/domain/slice.schemas";
import { TaskPropsSchema } from "@hexagons/task/domain/task.schemas";
import { ShipRecordPropsSchema } from "@hexagons/review/domain/schemas/ship.schemas";
import { CompletionRecordPropsSchema } from "@hexagons/review/domain/schemas/completion.schemas";
import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const StateSnapshotSchema = z.object({
  version: z.number().int().positive(),
  exportedAt: TimestampSchema,
  project: ProjectPropsSchema.nullable(),
  milestones: z.array(MilestonePropsSchema),
  slices: z.array(SlicePropsSchema),
  tasks: z.array(TaskPropsSchema),
  shipRecords: z.array(ShipRecordPropsSchema).default([]),
  completionRecords: z.array(CompletionRecordPropsSchema).default([]),
});
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

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

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  // Future migrations go here: e.g. 1 → 2
};

export function migrateSnapshot(raw: Record<string, unknown>): Record<string, unknown> {
  let data = { ...raw };
  let version = typeof data.version === "number" ? data.version : 0;

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Snapshot version ${version} is newer than supported version ${SCHEMA_VERSION}. Please update your tooling.`,
    );
  }

  while (version < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new Error(`No migration found for version ${version} → ${version + 1}`);
    }
    data = migrate(data);
    version++;
    data.version = version;
  }

  return data;
}
