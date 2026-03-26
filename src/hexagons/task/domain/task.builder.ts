import { faker } from "@faker-js/faker";
import { Task } from "./task.aggregate";
import type { TaskProps, TaskStatus } from "./task.schemas";

export class TaskBuilder {
  private _id: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _label = "T01";
  private _title: string = faker.lorem.words(3);
  private _description: string = faker.lorem.sentence();
  private _acceptanceCriteria: string = faker.lorem.sentence();
  private _filePaths: string[] = [];
  private _status: TaskStatus = "open";
  private _blockedBy: string[] = [];
  private _waveIndex: number | null = null;
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withSliceId(sliceId: string): this {
    this._sliceId = sliceId;
    return this;
  }

  withLabel(label: string): this {
    this._label = label;
    return this;
  }

  withTitle(title: string): this {
    this._title = title;
    return this;
  }

  withDescription(description: string): this {
    this._description = description;
    return this;
  }

  withAcceptanceCriteria(ac: string): this {
    this._acceptanceCriteria = ac;
    return this;
  }

  withFilePaths(paths: string[]): this {
    this._filePaths = paths;
    return this;
  }

  withStatus(status: TaskStatus): this {
    this._status = status;
    return this;
  }

  withBlockedBy(ids: string[]): this {
    this._blockedBy = ids;
    return this;
  }

  withWaveIndex(index: number): this {
    this._waveIndex = index;
    return this;
  }

  build(): Task {
    return Task.createNew({
      id: this._id,
      sliceId: this._sliceId,
      label: this._label,
      title: this._title,
      description: this._description,
      acceptanceCriteria: this._acceptanceCriteria,
      filePaths: this._filePaths,
      now: this._now,
    });
  }

  buildProps(): TaskProps {
    return {
      id: this._id,
      sliceId: this._sliceId,
      label: this._label,
      title: this._title,
      description: this._description,
      acceptanceCriteria: this._acceptanceCriteria,
      filePaths: this._filePaths,
      status: this._status,
      blockedBy: this._blockedBy,
      waveIndex: this._waveIndex,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
