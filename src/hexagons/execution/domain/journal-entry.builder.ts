import { faker } from "@faker-js/faker";
import type {
  ArtifactWrittenEntry,
  CheckpointSavedEntry,
  FileWrittenEntry,
  OverseerInterventionEntry,
  PhaseChangedEntry,
  TaskCompletedEntry,
  TaskFailedEntry,
  TaskStartedEntry,
} from "./journal-entry.schemas";

export class JournalEntryBuilder {
  private _sliceId = faker.string.uuid();
  private _timestamp = faker.date.recent();
  private _correlationId: string | undefined = undefined;

  withSliceId(id: string): this {
    this._sliceId = id;
    return this;
  }

  withTimestamp(ts: Date): this {
    this._timestamp = ts;
    return this;
  }

  withCorrelationId(id: string): this {
    this._correlationId = id;
    return this;
  }

  buildTaskStarted(
    overrides?: Partial<{
      taskId: string;
      waveIndex: number;
      agentIdentity: string;
    }>,
  ): Omit<TaskStartedEntry, "seq"> {
    return {
      type: "task-started",
      sliceId: this._sliceId,
      timestamp: this._timestamp,
      correlationId: this._correlationId,
      taskId: overrides?.taskId ?? faker.string.uuid(),
      waveIndex: overrides?.waveIndex ?? 0,
      agentIdentity: overrides?.agentIdentity ?? "opus",
    };
  }

  buildTaskCompleted(
    overrides?: Partial<{
      taskId: string;
      waveIndex: number;
      durationMs: number;
      commitHash: string;
    }>,
  ): Omit<TaskCompletedEntry, "seq"> {
    return {
      type: "task-completed",
      sliceId: this._sliceId,
      timestamp: this._timestamp,
      correlationId: this._correlationId,
      taskId: overrides?.taskId ?? faker.string.uuid(),
      waveIndex: overrides?.waveIndex ?? 0,
      durationMs: overrides?.durationMs ?? 1000,
      commitHash: overrides?.commitHash,
    };
  }

  buildTaskFailed(
    overrides?: Partial<{
      taskId: string;
      waveIndex: number;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
    }>,
  ): Omit<TaskFailedEntry, "seq"> {
    return {
      type: "task-failed",
      sliceId: this._sliceId,
      timestamp: this._timestamp,
      correlationId: this._correlationId,
      taskId: overrides?.taskId ?? faker.string.uuid(),
      waveIndex: overrides?.waveIndex ?? 0,
      errorCode: overrides?.errorCode ?? "AGENT.FAILURE",
      errorMessage: overrides?.errorMessage ?? "Task execution failed",
      retryable: overrides?.retryable ?? true,
    };
  }

  buildFileWritten(
    overrides?: Partial<{
      taskId: string;
      filePath: string;
      operation: "created" | "modified" | "deleted";
    }>,
  ): Omit<FileWrittenEntry, "seq"> {
    return {
      type: "file-written",
      sliceId: this._sliceId,
      timestamp: this._timestamp,
      correlationId: this._correlationId,
      taskId: overrides?.taskId ?? faker.string.uuid(),
      filePath: overrides?.filePath ?? `src/test/${faker.system.fileName()}`,
      operation: overrides?.operation ?? "created",
    };
  }

  buildCheckpointSaved(
    overrides?: Partial<{
      waveIndex: number;
      completedTaskCount: number;
    }>,
  ): Omit<CheckpointSavedEntry, "seq"> {
    return {
      type: "checkpoint-saved",
      sliceId: this._sliceId,
      timestamp: this._timestamp,
      correlationId: this._correlationId,
      waveIndex: overrides?.waveIndex ?? 0,
      completedTaskCount: overrides?.completedTaskCount ?? 0,
    };
  }

  buildPhaseChanged(
    overrides?: Partial<{
      from: string;
      to: string;
    }>,
  ): Omit<PhaseChangedEntry, "seq"> {
    return {
      type: "phase-changed",
      sliceId: this._sliceId,
      timestamp: this._timestamp,
      correlationId: this._correlationId,
      from: overrides?.from ?? "planning",
      to: overrides?.to ?? "executing",
    };
  }

  buildArtifactWritten(
    overrides?: Partial<{
      artifactPath: string;
      artifactType: "spec" | "plan" | "research" | "checkpoint";
    }>,
  ): Omit<ArtifactWrittenEntry, "seq"> {
    return {
      type: "artifact-written",
      sliceId: this._sliceId,
      timestamp: this._timestamp,
      correlationId: this._correlationId,
      artifactPath:
        overrides?.artifactPath ?? `.tff/milestones/M04/slices/M04-S02/${faker.system.fileName()}`,
      artifactType: overrides?.artifactType ?? "spec",
    };
  }

  buildOverseerIntervention(
    overrides?: Partial<{
      taskId: string;
      strategy: string;
      reason: string;
      action: "aborted" | "retrying" | "escalated";
      retryCount: number;
    }>,
  ): Omit<OverseerInterventionEntry, "seq"> {
    return {
      type: "overseer-intervention",
      sliceId: this._sliceId,
      timestamp: this._timestamp,
      correlationId: this._correlationId,
      taskId: overrides?.taskId ?? faker.string.uuid(),
      strategy: overrides?.strategy ?? "timeout",
      reason: overrides?.reason ?? "Task timed out",
      action: overrides?.action ?? "aborted",
      retryCount: overrides?.retryCount ?? 0,
    };
  }
}
