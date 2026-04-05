import { IdSchema, TimestampSchema } from "@kernel/schemas";
import { ProjectPropsSchema } from "@hexagons/project/domain/project.schemas";
import { MilestonePropsSchema } from "@hexagons/milestone/domain/milestone.schemas";
import { SlicePropsSchema } from "@hexagons/slice/domain/slice.schemas";
import { TaskPropsSchema } from "@hexagons/task/domain/task.schemas";
import { ShipRecordPropsSchema } from "@hexagons/review/domain/schemas/ship.schemas";
import { CompletionRecordPropsSchema } from "@hexagons/review/domain/schemas/completion.schemas";
import { WorkflowSessionPropsSchema } from "@hexagons/workflow/domain/workflow-session.schemas";
import { ReviewPropsSchema } from "@hexagons/review/domain/schemas/review.schemas";
import { VerificationPropsSchema } from "@hexagons/review/domain/schemas/verification.schemas";
import { z } from "zod";

export const SCHEMA_VERSION = 2;

export const StateSnapshotSchema = z.object({
  version: z.number().int().positive(),
  exportedAt: TimestampSchema,
  project: ProjectPropsSchema.nullable(),
  milestones: z.array(MilestonePropsSchema),
  slices: z.array(SlicePropsSchema),
  tasks: z.array(TaskPropsSchema),
  shipRecords: z.array(ShipRecordPropsSchema).default([]),
  completionRecords: z.array(CompletionRecordPropsSchema).default([]),
  workflowSessions: z.array(WorkflowSessionPropsSchema).default([]),
  reviews: z.array(ReviewPropsSchema).default([]),
  verifications: z.array(VerificationPropsSchema).default([]),
});
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

// BranchMeta is a kernel-level domain concept; canonical definition in @kernel/schemas/
export { BranchMetaSchema, type BranchMeta } from "@kernel/schemas/branch-meta.schemas";

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  1: (old) => ({ ...old, workflowSessions: [], reviews: [], verifications: [] }),
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
