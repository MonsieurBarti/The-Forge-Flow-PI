import { faker } from "@faker-js/faker";
import { WorkflowSession } from "./workflow-session.aggregate";
import type { WorkflowPhase, WorkflowSessionProps } from "./workflow-session.schemas";

export class WorkflowSessionBuilder {
  private _id: string = faker.string.uuid();
  private _milestoneId: string | null = faker.string.uuid();
  private _sliceId: string | undefined = undefined;
  private _currentPhase: WorkflowPhase = "idle";
  private _previousPhase: WorkflowPhase | undefined = undefined;
  private _retryCount = 0;
  private _autonomyMode: "guided" | "plan-to-pr" = "guided";
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }

  withMilestoneId(milestoneId: string): this {
    this._milestoneId = milestoneId;
    return this;
  }

  withNullMilestoneId(): this {
    this._milestoneId = null;
    return this;
  }

  withSliceId(sliceId: string): this {
    this._sliceId = sliceId;
    return this;
  }

  withCurrentPhase(phase: WorkflowPhase): this {
    this._currentPhase = phase;
    return this;
  }

  withPreviousPhase(phase: WorkflowPhase): this {
    this._previousPhase = phase;
    return this;
  }

  withRetryCount(count: number): this {
    this._retryCount = count;
    return this;
  }

  withAutonomyMode(mode: "guided" | "plan-to-pr"): this {
    this._autonomyMode = mode;
    return this;
  }

  build(): WorkflowSession {
    return WorkflowSession.reconstitute(this.buildProps());
  }

  buildProps(): WorkflowSessionProps {
    return {
      id: this._id,
      milestoneId: this._milestoneId,
      sliceId: this._sliceId,
      currentPhase: this._currentPhase,
      previousPhase: this._previousPhase,
      retryCount: this._retryCount,
      autonomyMode: this._autonomyMode,
      createdAt: this._now,
      updatedAt: this._now,
      lastEscalation: null,
    };
  }
}
