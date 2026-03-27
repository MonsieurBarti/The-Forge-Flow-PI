import type { DateProviderPort, EventBusPort, PersistenceError, Result } from "@kernel";
import { err, isErr, ok } from "@kernel";
import type { SliceTransitionError } from "../domain/errors/slice-transition.error";
import { WorkflowBaseError } from "../domain/errors/workflow-base.error";
import { mapPhaseToSliceStatus } from "../domain/phase-status-mapping";
import type { SliceTransitionPort } from "../domain/ports/slice-transition.port";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import type {
  GuardContext,
  WorkflowPhase,
  WorkflowTrigger,
} from "../domain/workflow-session.schemas";

export interface PhaseTransitionInput {
  milestoneId: string;
  trigger: WorkflowTrigger;
  guardContext: GuardContext;
}

export interface PhaseTransitionResult {
  fromPhase: WorkflowPhase;
  toPhase: WorkflowPhase;
  sliceTransitioned: boolean;
}

export class WorkflowSessionNotFoundError extends WorkflowBaseError {
  readonly code = "WORKFLOW.SESSION_NOT_FOUND";

  constructor(milestoneId: string) {
    super(`No workflow session found for milestone '${milestoneId}'`, { milestoneId });
  }
}

type OrchestrationError =
  | WorkflowBaseError
  | SliceTransitionError
  | PersistenceError
  | WorkflowSessionNotFoundError;

export class OrchestratePhaseTransitionUseCase {
  constructor(
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
    private readonly sliceTransitionPort: SliceTransitionPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(
    input: PhaseTransitionInput,
  ): Promise<Result<PhaseTransitionResult, OrchestrationError>> {
    const now = this.dateProvider.now();

    // 1. Load session
    const findResult = await this.sessionRepo.findByMilestoneId(input.milestoneId);
    if (isErr(findResult)) return findResult;
    if (!findResult.data) {
      return err(new WorkflowSessionNotFoundError(input.milestoneId));
    }

    const session = findResult.data;
    const fromPhase = session.currentPhase;
    const capturedSliceId = session.sliceId;

    // 2. Trigger transition
    const triggerResult = session.trigger(input.trigger, input.guardContext, now);
    if (isErr(triggerResult)) return triggerResult;

    // 3. Detect slice effects
    const sliceCleared = capturedSliceId !== undefined && session.sliceId === undefined;
    let sliceTransitioned = false;

    if (sliceCleared && session.currentPhase === "idle" && fromPhase === "shipping") {
      // shipping + next -> idle: close the slice
      const transitionResult = await this.sliceTransitionPort.transition(capturedSliceId, "closed");
      if (isErr(transitionResult)) return transitionResult;
      sliceTransitioned = true;
    } else if (sliceCleared) {
      // abort or other clearSlice: do NOT transition slice
      sliceTransitioned = false;
    } else if (capturedSliceId) {
      const mappedStatus = mapPhaseToSliceStatus(session.currentPhase);
      if (mappedStatus) {
        const transitionResult = await this.sliceTransitionPort.transition(
          capturedSliceId,
          mappedStatus,
        );
        if (isErr(transitionResult)) return transitionResult;
        sliceTransitioned = true;
      }
    }

    // 4. Save session
    const saveResult = await this.sessionRepo.save(session);
    if (isErr(saveResult)) return saveResult;

    // 5. Publish domain events
    const events = session.pullEvents();
    for (const event of events) {
      await this.eventBus.publish(event);
    }

    return ok({
      fromPhase,
      toPhase: session.currentPhase,
      sliceTransitioned,
    });
  }
}
