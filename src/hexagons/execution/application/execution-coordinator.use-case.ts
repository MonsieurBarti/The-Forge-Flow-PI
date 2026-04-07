import {
  type DateProviderPort,
  type EventBusPort,
  err,
  type LoggerPort,
  ok,
  type Result,
} from "@kernel";
import { ExecutionError } from "../domain/errors/execution.error";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import type { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";
import type { ExecutionSessionRepositoryPort } from "../domain/ports/execution-session-repository.port";
import type { PauseSignalPort } from "../domain/ports/pause-signal.port";
import type { ExecuteSliceResult } from "./execute-slice.schemas";
import type { ExecuteSliceUseCase } from "./execute-slice.use-case";
import type {
  ExecutionResult,
  PauseAcknowledgement,
  StartExecutionInput,
} from "./execution-coordinator.schemas";
import type { ReplayJournalUseCase } from "./replay-journal.use-case";

export interface ExecutionCoordinatorDeps {
  sessionRepository: ExecutionSessionRepositoryPort;
  pauseSignal: PauseSignalPort;
  executeSlice: Pick<ExecuteSliceUseCase, "execute">;
  replayJournal: Pick<ReplayJournalUseCase, "execute">;
  checkpointRepository: CheckpointRepositoryPort;
  eventBus: EventBusPort;
  dateProvider: DateProviderPort;
  logger: LoggerPort;
}

export class ExecutionCoordinator {
  private activeSession: ExecutionSession | null = null;

  constructor(private readonly deps: ExecutionCoordinatorDeps) {}

  async startExecution(
    input: StartExecutionInput,
  ): Promise<Result<ExecutionResult, ExecutionError>> {
    // 1. Check for existing session
    const existingResult = await this.deps.sessionRepository.findBySliceId(input.sliceId);
    if (existingResult.ok && existingResult.data) {
      const existing = existingResult.data;
      if (existing.status === "paused") {
        return err(
          ExecutionError.invalidState(input.sliceId, "Session is paused — use resume instead"),
        );
      }
      if (existing.status === "running") {
        return err(ExecutionError.invalidState(input.sliceId, "Session is already running"));
      }
      // Clean up completed/failed sessions
      await this.deps.sessionRepository.delete(input.sliceId);
    }

    // 2. Create + start session
    const session = ExecutionSession.createNew({
      id: crypto.randomUUID(),
      sliceId: input.sliceId,
      milestoneId: input.milestoneId,
      now: this.deps.dateProvider.now(),
    });
    const startResult = session.start(this.deps.dateProvider.now());
    if (!startResult.ok) {
      return err(ExecutionError.invalidState(input.sliceId, startResult.error.message));
    }

    // 3. Save session + publish events
    await this.deps.sessionRepository.save(session);
    for (const event of session.pullEvents()) {
      await this.deps.eventBus.publish(event);
    }

    // 4. Store active reference + register pause signal
    this.activeSession = session;
    this.deps.pauseSignal.register(() => session.requestPause());

    try {
      // 5. Execute
      const result = await this.deps.executeSlice.execute(input, session.signal);

      return this.handleExecutionResult(session, input.sliceId, result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      session.fail(message, this.deps.dateProvider.now());
      await this.deps.sessionRepository.save(session);
      for (const event of session.pullEvents()) {
        await this.deps.eventBus.publish(event);
      }
      return err(ExecutionError.unexpected(input.sliceId, message));
    } finally {
      this.deps.pauseSignal.dispose();
      this.activeSession = null;
    }
  }

  async pauseExecution(sliceId: string): Promise<Result<PauseAcknowledgement, ExecutionError>> {
    // In-memory path: active session exists
    if (this.activeSession && this.activeSession.sliceId === sliceId) {
      if (this.activeSession.status === "running") {
        this.activeSession.requestPause();
        return ok({ sliceId, status: "paused" as const });
      }
      if (this.activeSession.status === "paused") {
        return ok({ sliceId, status: "paused" as const });
      }
    }

    // Post-crash path: load from repository
    const sessionResult = await this.deps.sessionRepository.findBySliceId(sliceId);
    if (!sessionResult.ok) {
      return err(ExecutionError.invalidState(sliceId, "Failed to load session"));
    }
    const session = sessionResult.data;
    if (!session) {
      return err(ExecutionError.invalidState(sliceId, "No session found for slice"));
    }

    if (session.status === "paused") {
      return ok({ sliceId, status: "paused" as const });
    }

    if (session.status === "running") {
      // Orphaned running session — transition to paused
      const pauseResult = session.confirmPause(this.deps.dateProvider.now());
      if (!pauseResult.ok) {
        return err(ExecutionError.invalidState(sliceId, pauseResult.error.message));
      }
      await this.deps.sessionRepository.save(session);
      for (const event of session.pullEvents()) {
        await this.deps.eventBus.publish(event);
      }
      return ok({ sliceId, status: "paused" as const });
    }

    return err(
      ExecutionError.invalidState(sliceId, `Cannot pause session in status '${session.status}'`),
    );
  }

  async resumeExecution(
    sliceId: string,
    input: StartExecutionInput,
  ): Promise<Result<ExecutionResult, ExecutionError>> {
    // 1. Load session
    let session: ExecutionSession | null = null;
    const sessionResult = await this.deps.sessionRepository.findBySliceId(sliceId);
    if (sessionResult.ok) {
      session = sessionResult.data;
    }

    // 2. Crash recovery: no session but checkpoint exists
    if (!session) {
      const cpResult = await this.deps.checkpointRepository.findBySliceId(sliceId);
      if (!cpResult.ok || !cpResult.data) {
        return err(
          ExecutionError.invalidState(
            sliceId,
            "No session or checkpoint found — nothing to resume",
          ),
        );
      }
      // Create synthetic paused session
      session = ExecutionSession.createNew({
        id: crypto.randomUUID(),
        sliceId,
        milestoneId: input.milestoneId,
        now: this.deps.dateProvider.now(),
      });
      const synthStartResult = session.start(this.deps.dateProvider.now());
      if (!synthStartResult.ok) {
        return err(ExecutionError.invalidState(sliceId, synthStartResult.error.message));
      }
      const synthPauseResult = session.confirmPause(this.deps.dateProvider.now());
      if (!synthPauseResult.ok) {
        return err(ExecutionError.invalidState(sliceId, synthPauseResult.error.message));
      }
      this.deps.logger.info(`Created synthetic paused session for crash recovery: ${sliceId}`);
    }

    // 3. Validate status
    if (!session.canResume) {
      if (session.status === "failed") {
        return err(
          ExecutionError.invalidState(sliceId, "Session is failed — use execute for fresh start"),
        );
      }
      return err(
        ExecutionError.invalidState(sliceId, `Cannot resume session in status '${session.status}'`),
      );
    }

    // 4. Resume session (must be running before we can fail on inconsistency)
    const resumeResult = session.resume(this.deps.dateProvider.now());
    if (!resumeResult.ok) {
      return err(ExecutionError.invalidState(sliceId, resumeResult.error.message));
    }
    await this.deps.sessionRepository.save(session);
    for (const event of session.pullEvents()) {
      await this.deps.eventBus.publish(event);
    }

    // 5. Validate journal consistency
    const cpResult = await this.deps.checkpointRepository.findBySliceId(sliceId);
    if (cpResult.ok && cpResult.data) {
      const replayResult = await this.deps.replayJournal.execute({
        sliceId,
        checkpoint: {
          completedTasks: cpResult.data.completedTasks,
          currentWaveIndex: cpResult.data.currentWaveIndex,
        },
      });
      if (!replayResult.ok) {
        session.fail(
          `Journal inconsistency: ${replayResult.error.message}`,
          this.deps.dateProvider.now(),
        );
        await this.deps.sessionRepository.save(session);
        for (const event of session.pullEvents()) {
          await this.deps.eventBus.publish(event);
        }
        return err(
          ExecutionError.invalidState(
            sliceId,
            `Journal inconsistency: ${replayResult.error.message}`,
          ),
        );
      }
    }

    // 6. Register pause signal + execute
    this.activeSession = session;
    this.deps.pauseSignal.register(() => session.requestPause());

    try {
      const result = await this.deps.executeSlice.execute(input, session.signal);
      return this.handleExecutionResult(session, sliceId, result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      session.fail(message, this.deps.dateProvider.now());
      await this.deps.sessionRepository.save(session);
      for (const event of session.pullEvents()) {
        await this.deps.eventBus.publish(event);
      }
      return err(ExecutionError.unexpected(sliceId, message));
    } finally {
      this.deps.pauseSignal.dispose();
      this.activeSession = null;
    }
  }

  private async handleExecutionResult(
    session: ExecutionSession,
    sliceId: string,
    result: Result<ExecuteSliceResult, ExecutionError>,
  ): Promise<Result<ExecutionResult, ExecutionError>> {
    if (!result.ok) {
      const failResult = session.fail(result.error.message, this.deps.dateProvider.now());
      if (!failResult.ok) {
        return err(ExecutionError.invalidState(sliceId, failResult.error.message));
      }
      await this.deps.sessionRepository.save(session);
      for (const event of session.pullEvents()) {
        await this.deps.eventBus.publish(event);
      }
      return err(result.error);
    }

    const data = result.data;

    if (data.aborted && session.isPauseRequested) {
      // Pause path
      const pauseResult = session.confirmPause(this.deps.dateProvider.now());
      if (!pauseResult.ok) {
        return err(ExecutionError.invalidState(sliceId, pauseResult.error.message));
      }
      await this.deps.sessionRepository.save(session);
      for (const event of session.pullEvents()) {
        await this.deps.eventBus.publish(event);
      }
      return ok({
        sliceId,
        completedTasks: data.completedTasks,
        failedTasks: data.failedTasks,
        skippedTasks: data.skippedTasks,
        wavesCompleted: data.wavesCompleted,
        totalWaves: data.totalWaves,
        status: "paused",
        taskErrors: data.taskErrors,
      });
    }

    if (data.aborted) {
      // Failure abort (not pause)
      const reason =
        data.failedTasks.length > 0
          ? `Tasks failed: ${data.failedTasks.join(", ")}`
          : "Execution aborted";
      const failResult = session.fail(
        reason,
        this.deps.dateProvider.now(),
        data.wavesCompleted,
        data.totalWaves,
      );
      if (!failResult.ok) {
        return err(ExecutionError.invalidState(sliceId, failResult.error.message));
      }
      await this.deps.sessionRepository.save(session);
      for (const event of session.pullEvents()) {
        await this.deps.eventBus.publish(event);
      }
      return ok({
        sliceId,
        completedTasks: data.completedTasks,
        failedTasks: data.failedTasks,
        skippedTasks: data.skippedTasks,
        wavesCompleted: data.wavesCompleted,
        totalWaves: data.totalWaves,
        status: "failed",
        failureReason: reason,
        taskErrors: data.taskErrors,
      });
    }

    // Success path
    const completeResult = session.complete(
      this.deps.dateProvider.now(),
      data.wavesCompleted,
      data.totalWaves,
    );
    if (!completeResult.ok) {
      return err(ExecutionError.invalidState(sliceId, completeResult.error.message));
    }
    await this.deps.sessionRepository.save(session);
    for (const event of session.pullEvents()) {
      await this.deps.eventBus.publish(event);
    }
    return ok({
      sliceId,
      completedTasks: data.completedTasks,
      failedTasks: data.failedTasks,
      skippedTasks: data.skippedTasks,
      wavesCompleted: data.wavesCompleted,
      totalWaves: data.totalWaves,
      status: "completed",
      taskErrors: data.taskErrors,
    });
  }
}
