import { faker } from "@faker-js/faker";
import { Checkpoint } from "./checkpoint.aggregate";
import type { CheckpointProps, ExecutorLogEntry } from "./checkpoint.schemas";

export class CheckpointBuilder {
  private _id: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _baseCommit: string = faker.git.commitSha({ length: 7 });
  private _currentWaveIndex = 0;
  private _completedWaves: number[] = [];
  private _completedTasks: string[] = [];
  private _executorLog: ExecutorLogEntry[] = [];
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withSliceId(sliceId: string): this {
    this._sliceId = sliceId;
    return this;
  }

  withBaseCommit(baseCommit: string): this {
    this._baseCommit = baseCommit;
    return this;
  }

  withCurrentWaveIndex(index: number): this {
    this._currentWaveIndex = index;
    return this;
  }

  withCompletedWaves(waves: number[]): this {
    this._completedWaves = waves;
    return this;
  }

  withCompletedTasks(tasks: string[]): this {
    this._completedTasks = tasks;
    return this;
  }

  withExecutorLog(log: ExecutorLogEntry[]): this {
    this._executorLog = log;
    return this;
  }

  withNow(now: Date): this {
    this._now = now;
    return this;
  }

  build(): Checkpoint {
    return Checkpoint.createNew({
      id: this._id,
      sliceId: this._sliceId,
      baseCommit: this._baseCommit,
      now: this._now,
    });
  }

  buildProps(): CheckpointProps {
    return {
      version: 1,
      id: this._id,
      sliceId: this._sliceId,
      baseCommit: this._baseCommit,
      currentWaveIndex: this._currentWaveIndex,
      completedWaves: this._completedWaves,
      completedTasks: this._completedTasks,
      executorLog: this._executorLog,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
