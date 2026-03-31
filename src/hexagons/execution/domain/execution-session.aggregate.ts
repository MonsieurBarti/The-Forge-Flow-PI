import { AggregateRoot, err, ok, type Result } from "@kernel";
import { InvalidExecutionSessionStateError } from "./errors/invalid-execution-session-state.error";
import { ExecutionCompletedEvent } from "./events/execution-completed.event";
import { ExecutionFailedEvent } from "./events/execution-failed.event";
import { ExecutionPausedEvent } from "./events/execution-paused.event";
import { ExecutionResumedEvent } from "./events/execution-resumed.event";
import { ExecutionStartedEvent } from "./events/execution-started.event";
import {
  type ExecutionSessionProps,
  ExecutionSessionPropsSchema,
  type ExecutionSessionStatus,
} from "./execution-session.schemas";

export class ExecutionSession extends AggregateRoot<ExecutionSessionProps> {
  private controller: AbortController = new AbortController();

  private constructor(props: ExecutionSessionProps) {
    super(props, ExecutionSessionPropsSchema);
  }

  // -- Factories --

  static createNew(params: {
    id: string;
    sliceId: string;
    milestoneId: string;
    now: Date;
  }): ExecutionSession {
    return new ExecutionSession({
      id: params.id,
      sliceId: params.sliceId,
      milestoneId: params.milestoneId,
      status: "created",
      resumeCount: 0,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static reconstitute(props: ExecutionSessionProps): ExecutionSession {
    return new ExecutionSession(props);
  }

  // -- Getters --

  get id(): string {
    return this.props.id;
  }
  get sliceId(): string {
    return this.props.sliceId;
  }
  get milestoneId(): string {
    return this.props.milestoneId;
  }
  get status(): ExecutionSessionStatus {
    return this.props.status;
  }
  get resumeCount(): number {
    return this.props.resumeCount;
  }
  get failureReason(): string | undefined {
    return this.props.failureReason;
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  get isPauseRequested(): boolean {
    return this.controller.signal.aborted;
  }
  get canResume(): boolean {
    return this.props.status === "paused";
  }

  // -- State transitions --

  start(now: Date): Result<void, InvalidExecutionSessionStateError> {
    const guard = this.assertStatus("created");
    if (!guard.ok) return guard;
    this.controller = new AbortController();
    this.props.status = "running";
    this.props.startedAt = now;
    this.props.updatedAt = now;
    this.addEvent(
      new ExecutionStartedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        milestoneId: this.props.milestoneId,
        sessionId: this.props.id,
      }),
    );
    return ok(undefined);
  }

  requestPause(): void {
    if (this.props.status !== "running") return;
    this.controller.abort();
  }

  confirmPause(now: Date): Result<void, InvalidExecutionSessionStateError> {
    const guard = this.assertStatus("running");
    if (!guard.ok) return guard;
    this.props.status = "paused";
    this.props.pausedAt = now;
    this.props.updatedAt = now;
    this.addEvent(
      new ExecutionPausedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        sessionId: this.props.id,
        resumeCount: this.props.resumeCount,
      }),
    );
    return ok(undefined);
  }

  resume(now: Date): Result<void, InvalidExecutionSessionStateError> {
    const guard = this.assertStatus("paused");
    if (!guard.ok) return guard;
    this.controller = new AbortController();
    this.props.status = "running";
    this.props.resumeCount += 1;
    this.props.startedAt = now;
    this.props.pausedAt = undefined;
    this.props.updatedAt = now;
    this.addEvent(
      new ExecutionResumedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        sessionId: this.props.id,
        resumeCount: this.props.resumeCount,
      }),
    );
    return ok(undefined);
  }

  complete(
    now: Date,
    wavesCompleted: number,
    totalWaves: number,
  ): Result<void, InvalidExecutionSessionStateError> {
    const guard = this.assertStatus("running");
    if (!guard.ok) return guard;
    this.props.status = "completed";
    this.props.completedAt = now;
    this.props.updatedAt = now;
    this.addEvent(
      new ExecutionCompletedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        sessionId: this.props.id,
        resumeCount: this.props.resumeCount,
        wavesCompleted,
        totalWaves,
      }),
    );
    return ok(undefined);
  }

  fail(
    reason: string,
    now: Date,
    wavesCompleted?: number,
    totalWaves?: number,
  ): Result<void, InvalidExecutionSessionStateError> {
    const guard = this.assertStatus("running");
    if (!guard.ok) return guard;
    this.props.status = "failed";
    this.props.failureReason = reason;
    this.props.updatedAt = now;
    this.addEvent(
      new ExecutionFailedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        sliceId: this.props.sliceId,
        sessionId: this.props.id,
        resumeCount: this.props.resumeCount,
        failureReason: reason,
        wavesCompleted,
        totalWaves,
      }),
    );
    return ok(undefined);
  }

  // -- Private --

  private assertStatus(
    expected: ExecutionSessionStatus,
  ): Result<void, InvalidExecutionSessionStateError> {
    if (this.props.status !== expected) {
      return err(
        new InvalidExecutionSessionStateError(
          `Invalid state transition: expected '${expected}', got '${this.props.status}'`,
          { expected, actual: this.props.status },
        ),
      );
    }
    return ok(undefined);
  }
}
