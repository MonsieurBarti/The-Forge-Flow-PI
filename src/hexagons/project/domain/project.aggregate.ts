import { AggregateRoot, type Id } from "@kernel";
import { ProjectInitializedEvent } from "./events/project-initialized.event";
import { type ProjectProps, ProjectPropsSchema } from "./project.schemas";

export class Project extends AggregateRoot<ProjectProps> {
  private constructor(props: ProjectProps) {
    super(props, ProjectPropsSchema);
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get vision(): string {
    return this.props.vision;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  static init(params: { id: Id; name: string; vision: string; now: Date }): Project {
    const project = new Project({
      id: params.id,
      name: params.name,
      vision: params.vision,
      createdAt: params.now,
      updatedAt: params.now,
    });
    project.addEvent(
      new ProjectInitializedEvent({
        id: crypto.randomUUID(),
        aggregateId: params.id,
        occurredAt: params.now,
      }),
    );
    return project;
  }

  updateVision(vision: string, now: Date): void {
    this.props.vision = vision;
    this.props.updatedAt = now;
  }

  static reconstitute(props: ProjectProps): Project {
    return new Project(props);
  }
}
