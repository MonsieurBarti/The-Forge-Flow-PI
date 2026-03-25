import { faker } from "@faker-js/faker";
import { Project } from "./project.aggregate";
import type { ProjectProps } from "./project.schemas";

export class ProjectBuilder {
  private _id: string = faker.string.uuid();
  private _name: string = faker.company.name();
  private _vision: string = faker.lorem.sentence();
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withVision(vision: string): this {
    this._vision = vision;
    return this;
  }

  build(): Project {
    return Project.init({
      id: this._id,
      name: this._name,
      vision: this._vision,
      now: this._now,
    });
  }

  buildProps(): ProjectProps {
    return {
      id: this._id,
      name: this._name,
      vision: this._vision,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
