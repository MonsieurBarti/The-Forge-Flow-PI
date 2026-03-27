import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import type { DateProviderPort, EventBusPort, PersistenceError } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";
import type { WorkflowBaseError } from "../domain/errors/workflow-base.error";
import type { AutonomyModeProvider } from "../domain/ports/autonomy-mode.provider";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSession } from "../domain/workflow-session.aggregate";

export interface StartDiscussInput {
  sliceId: string;
  milestoneId: string;
}

export interface StartDiscussOutput {
  sessionId: string;
  fromPhase: string;
  toPhase: string;
  autonomyMode: string;
}

export class StartDiscussUseCase {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly autonomyModeProvider: AutonomyModeProvider,
  ) {}

  async execute(
    input: StartDiscussInput,
  ): Promise<
    Result<StartDiscussOutput, SliceNotFoundError | WorkflowBaseError | PersistenceError>
  > {
    // 1. Validate slice exists
    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(new SliceNotFoundError(input.sliceId));

    // 2. Find or create session
    const sessionResult = await this.sessionRepo.findByMilestoneId(input.milestoneId);
    if (isErr(sessionResult)) return sessionResult;

    const now = this.dateProvider.now();
    let session = sessionResult.data;
    if (!session) {
      session = WorkflowSession.createNew({
        id: crypto.randomUUID(),
        milestoneId: input.milestoneId,
        autonomyMode: this.autonomyModeProvider.getAutonomyMode(),
        now,
      });
    }

    // 3. Assign slice
    const fromPhase = session.currentPhase;
    const assignResult = session.assignSlice(input.sliceId);
    if (isErr(assignResult)) return assignResult;

    // 4. Trigger start transition
    const triggerResult = session.trigger(
      "start",
      {
        complexityTier: null,
        retryCount: 0,
        maxRetries: 2,
        allSlicesClosed: false,
        lastError: null,
      },
      now,
    );
    if (isErr(triggerResult)) return triggerResult;

    // 5. Save session
    const saveResult = await this.sessionRepo.save(session);
    if (isErr(saveResult)) return saveResult;

    // 6. Publish events
    for (const event of session.pullEvents()) {
      await this.eventBus.publish(event);
    }

    return ok({
      sessionId: session.id,
      fromPhase,
      toPhase: session.currentPhase,
      autonomyMode: session.autonomyMode,
    });
  }
}
