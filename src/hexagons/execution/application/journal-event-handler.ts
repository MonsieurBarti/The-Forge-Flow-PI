import { SliceStatusChangedEvent } from "@hexagons/slice/domain/events/slice-status-changed.event";
import { TaskBlockedEvent } from "@hexagons/task/domain/events/task-blocked.event";
import { TaskCompletedEvent } from "@hexagons/task/domain/events/task-completed.event";
import { type DomainEvent, EVENT_NAMES, type EventBusPort } from "@kernel";
import { CheckpointSavedEvent } from "../domain/events/checkpoint-saved.event";
import type {
  CheckpointSavedEntry,
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
}
