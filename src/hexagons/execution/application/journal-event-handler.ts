import { SliceStatusChangedEvent } from "@hexagons/slice/domain/events/slice-status-changed.event";
import { TaskBlockedEvent } from "@hexagons/task/domain/events/task-blocked.event";
import { TaskCompletedEvent } from "@hexagons/task/domain/events/task-completed.event";
import { type DomainEvent, EVENT_NAMES, type EventBusPort } from "@kernel";
import { CheckpointSavedEvent } from "../domain/events/checkpoint-saved.event";
import { ExecutionCompletedEvent } from "../domain/events/execution-completed.event";
import { ExecutionFailedEvent } from "../domain/events/execution-failed.event";
import { ExecutionPausedEvent } from "../domain/events/execution-paused.event";
import { ExecutionResumedEvent } from "../domain/events/execution-resumed.event";
import { ExecutionStartedEvent } from "../domain/events/execution-started.event";
import type {
  CheckpointSavedEntry,
  ExecutionLifecycleEntry,
  PhaseChangedEntry,
  TaskCompletedEntry,
  TaskFailedEntry,
} from "../domain/journal-entry.schemas";
import type { JournalRepositoryPort } from "../domain/ports/journal-repository.port";

export class JournalEventHandler {
  constructor(private readonly journalRepo: JournalRepositoryPort) {}

  register(eventBus: EventBusPort): void {
    eventBus.subscribe(EVENT_NAMES.CHECKPOINT_SAVED, (event) => this.onCheckpointSaved(event));
    eventBus.subscribe(EVENT_NAMES.TASK_COMPLETED, (event) => this.onTaskCompleted(event));
    eventBus.subscribe(EVENT_NAMES.TASK_BLOCKED, (event) => this.onTaskBlocked(event));
    eventBus.subscribe(EVENT_NAMES.SLICE_STATUS_CHANGED, (event) =>
      this.onSliceStatusChanged(event),
    );
    eventBus.subscribe(EVENT_NAMES.EXECUTION_STARTED, (event) => this.onExecutionLifecycle(event));
    eventBus.subscribe(EVENT_NAMES.EXECUTION_PAUSED, (event) => this.onExecutionLifecycle(event));
    eventBus.subscribe(EVENT_NAMES.EXECUTION_RESUMED, (event) => this.onExecutionLifecycle(event));
    eventBus.subscribe(EVENT_NAMES.EXECUTION_COMPLETED, (event) =>
      this.onExecutionLifecycle(event),
    );
    eventBus.subscribe(EVENT_NAMES.EXECUTION_FAILED, (event) => this.onExecutionLifecycle(event));
  }

  private async onCheckpointSaved(event: DomainEvent): Promise<void> {
    if (!(event instanceof CheckpointSavedEvent)) return;
    const entry: Omit<CheckpointSavedEntry, "seq"> = {
      type: "checkpoint-saved",
      sliceId: event.sliceId,
      timestamp: event.occurredAt,
      waveIndex: event.waveIndex,
      completedTaskCount: event.completedTaskCount,
    };
    await this.journalRepo.append(event.sliceId, entry);
  }

  private async onTaskCompleted(event: DomainEvent): Promise<void> {
    if (!(event instanceof TaskCompletedEvent)) return;
    const entry: Omit<TaskCompletedEntry, "seq"> = {
      type: "task-completed",
      sliceId: event.sliceId,
      timestamp: event.occurredAt,
      taskId: event.taskId,
      waveIndex: event.waveIndex,
      durationMs: event.durationMs,
      commitHash: event.commitHash,
    };
    await this.journalRepo.append(event.sliceId, entry);
  }

  private async onTaskBlocked(event: DomainEvent): Promise<void> {
    if (!(event instanceof TaskBlockedEvent)) return;
    const entry: Omit<TaskFailedEntry, "seq"> = {
      type: "task-failed",
      sliceId: event.sliceId,
      timestamp: event.occurredAt,
      taskId: event.taskId,
      waveIndex: event.waveIndex,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      retryable: true,
    };
    await this.journalRepo.append(event.sliceId, entry);
  }

  private async onSliceStatusChanged(event: DomainEvent): Promise<void> {
    if (!(event instanceof SliceStatusChangedEvent)) return;
    const sliceId = event.aggregateId;
    const entry: Omit<PhaseChangedEntry, "seq"> = {
      type: "phase-changed",
      sliceId, // sliceId IS the aggregateId for slices
      timestamp: event.occurredAt,
      from: event.from,
      to: event.to,
    };
    await this.journalRepo.append(sliceId, entry);
  }

  private async onExecutionLifecycle(event: DomainEvent): Promise<void> {
    let sliceId: string;
    let sessionId: string;
    let action: "started" | "paused" | "resumed" | "completed" | "failed";
    let resumeCount: number;
    let failureReason: string | undefined;
    let wavesCompleted: number | undefined;
    let totalWaves: number | undefined;

    if (event instanceof ExecutionStartedEvent) {
      sliceId = event.sliceId;
      sessionId = event.sessionId;
      action = "started";
      resumeCount = 0;
    } else if (event instanceof ExecutionPausedEvent) {
      sliceId = event.sliceId;
      sessionId = event.sessionId;
      action = "paused";
      resumeCount = event.resumeCount;
    } else if (event instanceof ExecutionResumedEvent) {
      sliceId = event.sliceId;
      sessionId = event.sessionId;
      action = "resumed";
      resumeCount = event.resumeCount;
    } else if (event instanceof ExecutionCompletedEvent) {
      sliceId = event.sliceId;
      sessionId = event.sessionId;
      action = "completed";
      resumeCount = event.resumeCount;
      wavesCompleted = event.wavesCompleted;
      totalWaves = event.totalWaves;
    } else if (event instanceof ExecutionFailedEvent) {
      sliceId = event.sliceId;
      sessionId = event.sessionId;
      action = "failed";
      resumeCount = event.resumeCount;
      failureReason = event.failureReason;
      wavesCompleted = event.wavesCompleted;
      totalWaves = event.totalWaves;
    } else {
      return;
    }

    const entry: Omit<ExecutionLifecycleEntry, "seq"> = {
      type: "execution-lifecycle",
      sliceId,
      timestamp: event.occurredAt,
      sessionId,
      action,
      resumeCount,
      failureReason,
      wavesCompleted,
      totalWaves,
    };
    await this.journalRepo.append(sliceId, entry);
  }
}
