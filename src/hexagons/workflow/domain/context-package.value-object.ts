import type { AgentType, ModelProfileName } from "@kernel";
import { ValueObject } from "@kernel";
import {
  type ContextPackageProps,
  ContextPackagePropsSchema,
  type SkillReference,
} from "./context-package.schemas";
import type { WorkflowPhase } from "./workflow-session.schemas";

export class ContextPackage extends ValueObject<ContextPackageProps> {
  private constructor(props: ContextPackageProps) {
    super(props, ContextPackagePropsSchema);
  }

  static create(props: ContextPackageProps): ContextPackage {
    return new ContextPackage(props);
  }

  get phase(): WorkflowPhase {
    return this.props.phase;
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get taskId(): string | undefined {
    return this.props.taskId;
  }

  get skills(): SkillReference[] {
    return this.props.skills;
  }

  get agentType(): AgentType {
    return this.props.agentType;
  }

  get modelProfile(): ModelProfileName {
    return this.props.modelProfile;
  }

  get filePaths(): string[] {
    return this.props.filePaths;
  }

  get taskPrompt(): string {
    return this.props.taskPrompt;
  }
}
