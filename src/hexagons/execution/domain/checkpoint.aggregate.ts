import { AggregateRoot, err, ok, type Result } from "@kernel";
import {
  type CheckpointProps,
  CheckpointPropsSchema,
  type ExecutorLogEntry,
} from "./checkpoint.schemas";
import { InvalidCheckpointStateError } from "./errors/invalid-checkpoint-state.error";
import { CheckpointSavedEvent } from "./events/checkpoint-saved.event";

export class Checkpoint extends AggregateRoot<CheckpointProps> {
  private constructor(props: CheckpointProps) {
    super(props, CheckpointPropsSchema);
  }

  // -- Factories --

  static createNew(params: {
    id: string;
    sliceId: string;
    baseCommit: string;
    now: Date;
  }): Checkpoint {
    return new Checkpoint({
      version: 1,
      id: params.id,
      sliceId: params.sliceId,
      baseCommit: params.baseCommit,
      currentWaveIndex: 0,
      completedWaves: [],
      completedTasks: [],
      executorLog: [],
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static reconstitute(props: CheckpointProps): Checkpoint {
    return new Checkpoint(props);
  }

  // -- Getters --

  get id(): string {
    return this.props.id;
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get baseCommit(): string {
    return this.props.baseCommit;
  }

  get currentWaveIndex(): number {
    return this.props.currentWaveIndex;
  }

  get completedWaves(): readonly number[] {
    return this.props.completedWaves;
  }

  get completedTasks(): readonly string[] {
    return this.props.completedTasks;
  }

  get executorLog(): readonly ExecutorLogEntry[] {
    return this.props.executorLog;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // -- Business Methods --

  recordTaskStart(
    taskId: string,
    agentIdentity: string,
    now: Date,
  ): Result<void, InvalidCheckpointStateError> {
    const existingIndex = this.props.executorLog.findIndex((e) => e.taskId === taskId);
    if (existingIndex >= 0) {
      this.props.executorLog = this.props.executorLog.map((e, i) =>
        i === existingIndex ? { ...e, agentIdentity } : e,
      );
      this.props.updatedAt = now;
      return ok(undefined);
    }
    this.props.executorLog = [
      ...this.props.executorLog,
      { taskId, agentIdentity, startedAt: now, completedAt: null },
    ];
    this.props.updatedAt = now;
    return ok(undefined);
  }

  recordTaskComplete(taskId: string, now: Date): Result<void, InvalidCheckpointStateError> {
    const entry = this.props.executorLog.find((e) => e.taskId === taskId);
    if (!entry) {
      return err(
        new InvalidCheckpointStateError(`Cannot complete task ${taskId}: not started`, { taskId }),
      );
    }
    if (entry.completedAt !== null) {
      return err(
        new InvalidCheckpointStateError(`Cannot complete task ${taskId}: already completed`, {
          taskId,
        }),
      );
    }
    this.props.executorLog = this.props.executorLog.map((e) =>
      e.taskId === taskId ? { ...e, completedAt: now } : e,
    );
    this.props.completedTasks = [...this.props.completedTasks, taskId];
    this.props.updatedAt = now;
    this.addEvent(
      new CheckpointSavedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        waveIndex: this.props.currentWaveIndex,
        completedTaskCount: this.props.completedTasks.length,
      }),
    );
    return ok(undefined);
  }

  advanceWave(now: Date): Result<void, InvalidCheckpointStateError> {
    if (this.props.completedWaves.includes(this.props.currentWaveIndex)) {
      return err(
        new InvalidCheckpointStateError(
          `Cannot advance wave: wave ${this.props.currentWaveIndex} already in completedWaves`,
          { waveIndex: this.props.currentWaveIndex },
        ),
      );
    }
    this.props.completedWaves = [...this.props.completedWaves, this.props.currentWaveIndex];
    this.props.currentWaveIndex += 1;
    this.props.updatedAt = now;
    this.addEvent(
      new CheckpointSavedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        waveIndex: this.props.currentWaveIndex - 1,
        completedTaskCount: this.props.completedTasks.length,
      }),
    );
    return ok(undefined);
  }

  // -- Queries --

  isTaskCompleted(taskId: string): boolean {
    return this.props.completedTasks.includes(taskId);
  }

  isWaveCompleted(waveIndex: number): boolean {
    return this.props.completedWaves.includes(waveIndex);
  }

  isTaskStarted(taskId: string): boolean {
    return this.props.executorLog.some((e) => e.taskId === taskId);
  }
}
