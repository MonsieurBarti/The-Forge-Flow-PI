import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------
const JournalEntryBaseSchema = z.object({
  seq: z.number().int().min(0),
  sliceId: IdSchema,
  timestamp: TimestampSchema,
  correlationId: IdSchema.optional(),
});

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------
export const TaskStartedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("task-started"),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  agentIdentity: z.string().min(1),
});
export type TaskStartedEntry = z.infer<typeof TaskStartedEntrySchema>;

export const TaskCompletedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("task-completed"),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  commitHash: z.string().optional(),
});
export type TaskCompletedEntry = z.infer<typeof TaskCompletedEntrySchema>;

export const TaskFailedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("task-failed"),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  errorCode: z.string(),
  errorMessage: z.string(),
  retryable: z.boolean(),
});
export type TaskFailedEntry = z.infer<typeof TaskFailedEntrySchema>;

export const FileWrittenEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("file-written"),
  taskId: IdSchema,
  filePath: z.string().min(1),
  operation: z.enum(["created", "modified", "deleted"]),
});
export type FileWrittenEntry = z.infer<typeof FileWrittenEntrySchema>;

export const CheckpointSavedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("checkpoint-saved"),
  waveIndex: z.number().int().min(0),
  completedTaskCount: z.number().int().min(0),
});
export type CheckpointSavedEntry = z.infer<typeof CheckpointSavedEntrySchema>;

export const PhaseChangedEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("phase-changed"),
  from: z.string(),
  to: z.string(),
});
export type PhaseChangedEntry = z.infer<typeof PhaseChangedEntrySchema>;

export const ArtifactWrittenEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("artifact-written"),
  artifactPath: z.string().min(1),
  artifactType: z.enum(["spec", "plan", "research", "checkpoint"]),
});
export type ArtifactWrittenEntry = z.infer<typeof ArtifactWrittenEntrySchema>;

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------
export const JournalEntrySchema = z.discriminatedUnion("type", [
  TaskStartedEntrySchema,
  TaskCompletedEntrySchema,
  TaskFailedEntrySchema,
  FileWrittenEntrySchema,
  CheckpointSavedEntrySchema,
  PhaseChangedEntrySchema,
  ArtifactWrittenEntrySchema,
]);
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
