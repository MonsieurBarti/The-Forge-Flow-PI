import { AggregateRoot } from "@kernel";
import { ExecutionCompletedEvent } from "./events/execution-completed.event";
import { ExecutionFailedEvent } from "./events/execution-failed.event";
import { ExecutionPausedEvent } from "./events/execution-paused.event";
import { ExecutionResumedEvent } from "./events/execution-resumed.event";
import { ExecutionStartedEvent } from "./events/execution-started.event";
import {
  type ExecutionSessionProps,
  ExecutionSessionPropsSchema,
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
  get status(): string {
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

  start(now: Date): void {
    this.assertStatus("created");
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
  }

  requestPause(): void {
    if (this.props.status !== "running") return;
    this.controller.abort();
  }

  confirmPause(now: Date): void {
    this.assertStatus("running");
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
  }

  resume(now: Date): void {
    this.assertStatus("paused");
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
  }

  complete(now: Date, wavesCompleted: number, totalWaves: number): void {
    this.assertStatus("running");
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
  }

  fail(reason: string, now: Date, wavesCompleted?: number, totalWaves?: number): void {
    this.assertStatus("running");
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
  }

  // -- Private --

  private assertStatus(expected: string): void {
    if (this.props.status !== expected) {
      throw new Error(
        `Invalid state transition: expected '${expected}', got '${this.props.status}'`,
      );
    }
  }
}
