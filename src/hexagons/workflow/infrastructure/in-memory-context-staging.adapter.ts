import { err, ok, type Result } from "@kernel";
import {
  buildTaskPrompt,
  isActivePhase,
  resolveAgentType,
} from "../domain/context-package.helpers";
import { ContextPackage } from "../domain/context-package.value-object";
import {
  type ContextStagingError,
  InvalidPhaseForStagingError,
} from "../domain/errors/context-staging.error";
import { selectSkillsForPhase } from "../domain/phase-skill-map";
import {
  ContextStagingPort,
  type ContextStagingRequest,
} from "../domain/ports/context-staging.port";
import type { ModelProfileResolverPort } from "../domain/ports/model-profile-resolver.port";

export class InMemoryContextStagingAdapter extends ContextStagingPort {
  constructor(private readonly deps: { modelProfileResolver: ModelProfileResolverPort }) {
    super();
  }

  async stage(
    request: ContextStagingRequest,
  ): Promise<Result<ContextPackage, ContextStagingError>> {
    const { phase, sliceId, taskId, complexity, filePaths, taskDescription, acceptanceCriteria } =
      request;

    if (!isActivePhase(phase)) {
      return err(new InvalidPhaseForStagingError(phase));
    }

    const skills = selectSkillsForPhase(phase);
    const agentType = resolveAgentType(phase);
    const modelProfile = await this.deps.modelProfileResolver.resolveForPhase(phase, complexity);
    const taskPrompt = buildTaskPrompt(taskDescription, acceptanceCriteria);

    return ok(
      ContextPackage.create({
        phase,
        sliceId,
        taskId,
        skills,
        agentType,
        modelProfile,
        filePaths,
        taskPrompt,
      }),
    );
  }
}
