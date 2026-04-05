import type { DateProviderPort, EventBusPort, PersistenceError, Result } from "@kernel";
import { err, isErr, ok } from "@kernel";
import type { SliceTransitionError } from "../domain/errors/slice-transition.error";
import { WorkflowBaseError } from "../domain/errors/workflow-base.error";
import { mapPhaseToSliceStatus } from "../domain/phase-status-mapping";
import type { SliceTransitionPort } from "../domain/ports/slice-transition.port";
import type { WorkflowJournalPort } from "../domain/ports/workflow-journal.port";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import type { WorkflowSession } from "../domain/workflow-session.aggregate";
import type {
  GuardContext,
  WorkflowPhase,
  WorkflowTrigger,
} from "../domain/workflow-session.schemas";

export interface PhaseTransitionInput {
  milestoneId?: string;
  sliceId?: string;
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
    private readonly workflowJournal?: WorkflowJournalPort,
  ) {}

  async execute(
    input: PhaseTransitionInput,
  ): Promise<Result<PhaseTransitionResult, OrchestrationError>> {
    const now = this.dateProvider.now();

    // 1. Load session
    let findResult: Result<WorkflowSession | null, PersistenceError>;
    if (input.milestoneId) {
      findResult = await this.sessionRepo.findByMilestoneId(input.milestoneId);
    } else if (input.sliceId) {
      findResult = await this.sessionRepo.findBySliceId(input.sliceId);
    } else {
      return err(new WorkflowSessionNotFoundError("no milestoneId or sliceId provided"));
    }
    if (isErr(findResult)) return findResult;
    if (!findResult.data) {
      return err(
        new WorkflowSessionNotFoundError(
          input.milestoneId
            ? `No workflow session found for milestone '${input.milestoneId}'`
            : `No workflow session found for slice '${input.sliceId}'`,
        ),
      );
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

    // Write-through to workflow journal
    if (this.workflowJournal) {
      await this.workflowJournal.append({
        type: "phase-transition",
        sessionId: session.id,
        milestoneId: input.milestoneId ?? "",
        sliceId: session.sliceId,
        fromPhase,
        toPhase: session.currentPhase,
        trigger: input.trigger,
        timestamp: this.dateProvider.now(),
      });
    }

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
