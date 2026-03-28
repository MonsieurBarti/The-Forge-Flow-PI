import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import { err, isErr, ok, type PersistenceError, type Result } from "@kernel";
import type { WorkflowBaseError } from "../domain/errors/workflow-base.error";
import {
  NextStepSuggestion,
  type NextStepSuggestionProps,
} from "../domain/next-step-suggestion.vo";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSessionNotFoundError } from "./orchestrate-phase-transition.use-case";

export interface SuggestNextStepInput {
  milestoneId: string;
}

export type SuggestNextStepError =
  | WorkflowSessionNotFoundError
  | SliceNotFoundError
  | WorkflowBaseError
  | PersistenceError;

export class SuggestNextStepUseCase {
  constructor(
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
    private readonly sliceRepo: SliceRepositoryPort,
  ) {}

  async execute(
    input: SuggestNextStepInput,
  ): Promise<Result<NextStepSuggestionProps | null, SuggestNextStepError>> {
    // 1. Load session
    const sessionResult = await this.sessionRepo.findByMilestoneId(input.milestoneId);
    if (isErr(sessionResult)) return sessionResult;
    if (!sessionResult.data) {
      return err(new WorkflowSessionNotFoundError(input.milestoneId));
    }
    const session = sessionResult.data;

    // 2. Load slice if assigned
    let sliceLabel: string | undefined;
    let tier: "S" | "F-lite" | "F-full" | undefined;
    if (session.sliceId) {
      const sliceResult = await this.sliceRepo.findById(session.sliceId);
      if (isErr(sliceResult)) return sliceResult;
      if (!sliceResult.data) {
        return err(new SliceNotFoundError(session.sliceId));
      }
      sliceLabel = sliceResult.data.label;
      tier = sliceResult.data.complexity ?? undefined;
    }

    // 3. Compute allSlicesClosed
    const allSlicesResult = await this.sliceRepo.findByMilestoneId(input.milestoneId);
    if (isErr(allSlicesResult)) return allSlicesResult;
    const allSlicesClosed =
      allSlicesResult.data.length > 0 && allSlicesResult.data.every((s) => s.status === "closed");

    // 4. Build suggestion
    const suggestion = NextStepSuggestion.build({
      phase: session.currentPhase,
      autonomyMode: session.autonomyMode,
      tier,
      sliceLabel,
      previousPhase: session.previousPhase,
      allSlicesClosed,
    });

    return ok(suggestion?.toProps ?? null);
  }
}
