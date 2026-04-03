import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";
import { GuardrailViolationSchema } from "./guardrail.schemas";
import { InterventionActionSchema } from "./overseer.schemas";

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

export const GuardrailViolationEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("guardrail-violation"),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  violations: z.array(GuardrailViolationSchema),
  action: z.enum(["blocked", "warned"]),
});
export type GuardrailViolationEntry = z.infer<typeof GuardrailViolationEntrySchema>;

export const OverseerInterventionEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("overseer-intervention"),
  taskId: IdSchema,
  strategy: z.string().min(1),
  reason: z.string().min(1),
  action: InterventionActionSchema,
  retryCount: z.number().int().min(0),
});
export type OverseerInterventionEntry = z.infer<typeof OverseerInterventionEntrySchema>;

export const ExecutionLifecycleEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("execution-lifecycle"),
  sessionId: IdSchema,
  action: z.enum(["started", "paused", "resumed", "completed", "failed"]),
  resumeCount: z.number().int().min(0),
  failureReason: z.string().optional(),
  wavesCompleted: z.number().int().min(0).optional(),
  totalWaves: z.number().int().min(0).optional(),
});
export type ExecutionLifecycleEntry = z.infer<typeof ExecutionLifecycleEntrySchema>;

export const ToolExecutionEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("tool-execution"),
  taskId: IdSchema,
  turnIndex: z.number().int().min(0),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  durationMs: z.number().int().min(0),
  isError: z.boolean(),
});
export type ToolExecutionEntry = z.infer<typeof ToolExecutionEntrySchema>;

export const TurnBoundaryEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("turn-boundary"),
  taskId: IdSchema,
  turnIndex: z.number().int().min(0),
  boundary: z.enum(["start", "end"]),
  toolCallCount: z.number().int().min(0).optional(),
});
export type TurnBoundaryEntry = z.infer<typeof TurnBoundaryEntrySchema>;

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
  GuardrailViolationEntrySchema,
  OverseerInterventionEntrySchema,
  ExecutionLifecycleEntrySchema,
  ToolExecutionEntrySchema,
  TurnBoundaryEntrySchema,
]);
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
