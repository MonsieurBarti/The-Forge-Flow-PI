import { faker } from "@faker-js/faker";
import { Slice } from "./slice.aggregate";
import type { ComplexityTier, SliceProps, SliceStatus } from "./slice.schemas";

export class SliceBuilder {
  private _id: string = faker.string.uuid();
  private _milestoneId: string = faker.string.uuid();
  private _label = "M01-S01";
  private _title: string = faker.lorem.words(3);
  private _description: string = faker.lorem.sentence();
  private _status: SliceStatus = "discussing";
  private _complexity: ComplexityTier | null = null;
  private _specPath: string | null = null;
  private _planPath: string | null = null;
  private _researchPath: string | null = null;
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withMilestoneId(milestoneId: string): this {
    this._milestoneId = milestoneId;
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

  withStatus(status: SliceStatus): this {
    this._status = status;
    return this;
  }

  withComplexity(tier: ComplexityTier): this {
    this._complexity = tier;
    return this;
  }

  withSpecPath(path: string): this {
    this._specPath = path;
    return this;
  }

  withPlanPath(path: string): this {
    this._planPath = path;
    return this;
  }

  withResearchPath(path: string): this {
    this._researchPath = path;
    return this;
  }

  build(): Slice {
    return Slice.createNew({
      id: this._id,
      milestoneId: this._milestoneId,
      label: this._label,
      title: this._title,
      description: this._description,
      now: this._now,
    });
  }

  buildProps(): SliceProps {
    return {
      id: this._id,
      milestoneId: this._milestoneId,
      label: this._label,
      title: this._title,
      description: this._description,
      status: this._status,
      complexity: this._complexity,
      specPath: this._specPath,
      planPath: this._planPath,
      researchPath: this._researchPath,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
