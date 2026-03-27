import { faker } from "@faker-js/faker";
import type { AgentType, ModelProfileName } from "@kernel";
import type { ContextPackageProps, SkillReference } from "./context-package.schemas";
import { ContextPackage } from "./context-package.value-object";
import type { WorkflowPhase } from "./workflow-session.schemas";

export class ContextPackageBuilder {
  private _phase: WorkflowPhase = "executing";
  private _sliceId: string = faker.string.uuid();
  private _taskId: string | undefined = undefined;
  private _skills: SkillReference[] = [{ name: "test-driven-development", type: "rigid" }];
  private _agentType: AgentType = "fixer";
  private _modelProfile: ModelProfileName = "balanced";
  private _filePaths: string[] = ["src/example.ts"];
  private _taskPrompt: string = faker.lorem.sentence();

  withPhase(phase: WorkflowPhase): this {
    this._phase = phase;
    return this;
  }

  withSliceId(sliceId: string): this {
    this._sliceId = sliceId;
    return this;
  }

  withTaskId(taskId: string): this {
    this._taskId = taskId;
    return this;
  }

  withSkills(skills: SkillReference[]): this {
    this._skills = skills;
    return this;
  }

  withAgentType(agentType: AgentType): this {
    this._agentType = agentType;
    return this;
  }

  withModelProfile(modelProfile: ModelProfileName): this {
    this._modelProfile = modelProfile;
    return this;
  }

  withFilePaths(filePaths: string[]): this {
    this._filePaths = filePaths;
    return this;
  }

  withTaskPrompt(taskPrompt: string): this {
    this._taskPrompt = taskPrompt;
    return this;
  }

  build(): ContextPackage {
    return ContextPackage.create(this.buildProps());
  }

  buildProps(): ContextPackageProps {
    return {
      phase: this._phase,
      sliceId: this._sliceId,
      taskId: this._taskId,
      skills: this._skills,
      agentType: this._agentType,
      modelProfile: this._modelProfile,
      filePaths: this._filePaths,
      taskPrompt: this._taskPrompt,
    };
  }
}
