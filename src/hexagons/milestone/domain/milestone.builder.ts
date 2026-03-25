import { faker } from "@faker-js/faker";
import { Milestone } from "./milestone.aggregate";
import type { MilestoneProps, MilestoneStatus } from "./milestone.schemas";

export class MilestoneBuilder {
  private _id: string = faker.string.uuid();
  private _projectId: string = faker.string.uuid();
  private _label = "M01";
  private _title: string = faker.lorem.words(3);
  private _description: string = faker.lorem.sentence();
  private _status: MilestoneStatus = "open";
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withProjectId(projectId: string): this {
    this._projectId = projectId;
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

  withStatus(status: MilestoneStatus): this {
    this._status = status;
    return this;
  }

  build(): Milestone {
    return Milestone.createNew({
      id: this._id,
      projectId: this._projectId,
      label: this._label,
      title: this._title,
      description: this._description,
      now: this._now,
    });
  }

  buildProps(): MilestoneProps {
    return {
      id: this._id,
      projectId: this._projectId,
      label: this._label,
      title: this._title,
      description: this._description,
      status: this._status,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
