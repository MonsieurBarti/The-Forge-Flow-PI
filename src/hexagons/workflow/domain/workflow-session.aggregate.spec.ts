import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { shouldAutoTransition } from "./autonomy-policy";
import type { WorkflowEscalationRaisedEvent } from "./events/workflow-escalation-raised.event";
import { WorkflowSession } from "./workflow-session.aggregate";
import { WorkflowSessionBuilder } from "./workflow-session.builder";
import type { GuardContext } from "./workflow-session.schemas";

const defaultCtx: GuardContext = {
  complexityTier: "F-lite",
  retryCount: 0,
  maxRetries: 2,
  allSlicesClosed: false,
  lastError: null,
  failurePolicy: "strict",
};

describe("WorkflowSession", () => {
  describe("createNew", () => {
    it("starts at idle phase", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      expect(session.currentPhase).toBe("idle");
      expect(session.sliceId).toBeUndefined();
      expect(session.retryCount).toBe(0);
    });
  });

  describe("assignSlice", () => {
    it("assigns when no slice is set", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const sliceId = faker.string.uuid();
      const result = session.assignSlice(sliceId);
      expect(result.ok).toBe(true);
      expect(session.sliceId).toBe(sliceId);
    });

    it("returns error when slice already assigned", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.assignSlice(faker.string.uuid());
      const result = session.assignSlice(faker.string.uuid());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("WORKFLOW.SLICE_ALREADY_ASSIGNED");
    });
  });

  describe("clearSlice", () => {
    it("nullifies sliceId and resets retryCount", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.assignSlice(faker.string.uuid());
      session.trigger("start", defaultCtx, new Date());
      session.clearSlice();
      expect(session.sliceId).toBeUndefined();
      expect(session.retryCount).toBe(0);
    });
  });

  describe("trigger — happy path transitions", () => {
    it("idle + start → discussing", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const result = session.trigger("start", defaultCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("discussing");
    });

    it("discussing + next → researching (notSTier)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const result = session.trigger("next", defaultCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("researching");
    });

    it("discussing + next → planning (isSTier)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const sTierCtx: GuardContext = { ...defaultCtx, complexityTier: "S" };
      const result = session.trigger("next", sTierCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("planning");
    });

    it("discussing + skip → planning", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const result = session.trigger("skip", defaultCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("planning");
    });
  });

  describe("trigger — full lifecycle", () => {
    it("walks the complete happy path: idle → discussing → researching → planning → executing → verifying → reviewing → shipping → idle", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      expect(session.currentPhase).toBe("discussing");

      session.trigger("next", defaultCtx, new Date());
      expect(session.currentPhase).toBe("researching");

      session.trigger("next", defaultCtx, new Date());
      expect(session.currentPhase).toBe("planning");

      session.trigger("approve", defaultCtx, new Date());
      expect(session.currentPhase).toBe("executing");

      session.trigger("next", defaultCtx, new Date());
      expect(session.currentPhase).toBe("verifying");

      session.trigger("approve", defaultCtx, new Date());
      expect(session.currentPhase).toBe("reviewing");

      session.trigger("approve", defaultCtx, new Date());
      expect(session.currentPhase).toBe("shipping");

      session.trigger("next", defaultCtx, new Date());
      expect(session.currentPhase).toBe("idle");
      expect(session.sliceId).toBeUndefined();
    });

    it("verifying + reject → executing (rule 10)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("skip", defaultCtx, new Date());
      session.trigger("approve", defaultCtx, new Date());
      session.trigger("next", defaultCtx, new Date());
      expect(session.currentPhase).toBe("verifying");
      session.trigger("reject", defaultCtx, new Date());
      expect(session.currentPhase).toBe("executing");
      expect(session.retryCount).toBe(1);
    });

    it("reviewing + reject → executing (rule 12)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("skip", defaultCtx, new Date());
      session.trigger("approve", defaultCtx, new Date());
      session.trigger("next", defaultCtx, new Date());
      session.trigger("approve", defaultCtx, new Date());
      expect(session.currentPhase).toBe("reviewing");
      session.trigger("reject", defaultCtx, new Date());
      expect(session.currentPhase).toBe("executing");
      expect(session.retryCount).toBe(1);
    });

    it("completing-milestone + next → idle (rule 15)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const closedCtx: GuardContext = { ...defaultCtx, allSlicesClosed: true };
      session.trigger("next", closedCtx, new Date());
      expect(session.currentPhase).toBe("completing-milestone");
      session.trigger("next", defaultCtx, new Date());
      expect(session.currentPhase).toBe("idle");
    });
  });

  describe("trigger — retry and back-edges", () => {
    it("planning + reject increments retryCount", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("skip", defaultCtx, new Date());
      session.trigger("reject", defaultCtx, new Date());
      expect(session.retryCount).toBe(1);
      expect(session.currentPhase).toBe("planning");
    });

    it("planning + approve resets retryCount", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("skip", defaultCtx, new Date());
      session.trigger("reject", defaultCtx, new Date());
      expect(session.retryCount).toBe(1);
      session.trigger("approve", defaultCtx, new Date());
      expect(session.retryCount).toBe(0);
      expect(session.currentPhase).toBe("executing");
    });
  });

  describe("trigger — pause/resume", () => {
    it("pause saves previousPhase, resume restores it", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      expect(session.currentPhase).toBe("discussing");
      session.trigger("pause", defaultCtx, new Date());
      expect(session.currentPhase).toBe("paused");
      expect(session.previousPhase).toBe("discussing");
      session.trigger("resume", defaultCtx, new Date());
      expect(session.currentPhase).toBe("discussing");
    });
  });

  describe("trigger — blocked", () => {
    it("fail + retriesExhausted transitions to blocked", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const exhaustedCtx: GuardContext = { ...defaultCtx, retryCount: 2, maxRetries: 2 };
      const result = session.trigger("fail", exhaustedCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("blocked");
    });

    it("fail without retriesExhausted returns guard rejected", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const result = session.trigger("fail", defaultCtx, new Date());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("WORKFLOW.GUARD_REJECTED");
    });

    it("blocked + abort returns to idle", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("fail", { ...defaultCtx, retryCount: 2, maxRetries: 2 }, new Date());
      const result = session.trigger("abort", defaultCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("idle");
    });
  });

  describe("trigger — completing-milestone", () => {
    it("idle + next + allSlicesClosed → completing-milestone", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const closedCtx: GuardContext = { ...defaultCtx, allSlicesClosed: true };
      const result = session.trigger("next", closedCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("completing-milestone");
    });
  });

  describe("trigger — events", () => {
    it("emits WorkflowPhaseChangedEvent on every transition", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.pullEvents(); // clear any creation events
      session.trigger("start", defaultCtx, new Date());
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("workflow.phase-changed");
    });
  });

  describe("trigger — error cases", () => {
    it("returns NoMatchingTransitionError for invalid combo", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const result = session.trigger("approve", defaultCtx, new Date());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("WORKFLOW.NO_MATCHING_TRANSITION");
    });
  });

  describe("createNew — nullable milestoneId", () => {
    it("creates session with null milestoneId for ad-hoc slices", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      expect(session.milestoneId).toBeNull();
    });

    it("creates session with milestoneId for milestone slices", () => {
      const milestoneId = faker.string.uuid();
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId,
        autonomyMode: "guided",
        now: new Date(),
      });
      expect(session.milestoneId).toBe(milestoneId);
    });

    it("emits phase changed event with null milestoneId", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.pullEvents();
      session.trigger("start", defaultCtx, new Date());
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      const phaseEvent =
        events[0] as import("./events/workflow-phase-changed.event").WorkflowPhaseChangedEvent;
      expect(phaseEvent.milestoneId).toBeNull();
    });
  });

  describe("reconstitute", () => {
    it("reconstitutes from props without events", () => {
      const now = new Date();
      const session = WorkflowSession.reconstitute({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        currentPhase: "executing",
        previousPhase: "planning",
        retryCount: 1,
        autonomyMode: "plan-to-pr",
        createdAt: now,
        updatedAt: now,
        lastEscalation: null,
      });
      expect(session.currentPhase).toBe("executing");
      expect(session.pullEvents()).toHaveLength(0);
    });
  });

  describe("shouldAutoTransition getter", () => {
    it("delegates to pure shouldAutoTransition function for guided mode", () => {
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("discussing")
        .withAutonomyMode("guided")
        .build();
      expect(session.shouldAutoTransition).toBe(false);
      expect(session.shouldAutoTransition).toBe(
        shouldAutoTransition("discussing", "guided").autoTransition,
      );
    });

    it("returns true for non-gate phase in plan-to-pr mode", () => {
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("discussing")
        .withAutonomyMode("plan-to-pr")
        .build();
      expect(session.shouldAutoTransition).toBe(true);
    });

    it("returns false for gate phase in plan-to-pr mode", () => {
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("planning")
        .withAutonomyMode("plan-to-pr")
        .build();
      expect(session.shouldAutoTransition).toBe(false);
    });
  });

  describe("escalation on blocked transition", () => {
    it("emits WorkflowEscalationRaisedEvent when transitioning to blocked", () => {
      const sliceId = faker.string.uuid();
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("executing")
        .withSliceId(sliceId)
        .withRetryCount(2)
        .build();

      const ctx: GuardContext = {
        complexityTier: "F-lite",
        retryCount: 2,
        maxRetries: 2,
        allSlicesClosed: false,
        lastError: "Test failed: expected 1 but got 2",
        failurePolicy: "strict",
      };

      const result = session.trigger("fail", ctx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("blocked");

      const events = session.pullEvents();
      const phaseEvent = events.find((e) => e.eventName === "workflow.phase-changed");
      const escalationEvent = events.find(
        (e): e is WorkflowEscalationRaisedEvent => e.eventName === "workflow.escalation-raised",
      );

      expect(phaseEvent).toBeDefined();
      expect(escalationEvent).toBeDefined();
      expect(escalationEvent?.escalation.sliceId).toBe(sliceId);
      expect(escalationEvent?.escalation.phase).toBe("executing");
      expect(escalationEvent?.escalation.attempts).toBe(2);
      expect(escalationEvent?.escalation.lastError).toBe("Test failed: expected 1 but got 2");
    });

    it("stores escalation on aggregate accessible via lastEscalation", () => {
      const sliceId = faker.string.uuid();
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("executing")
        .withSliceId(sliceId)
        .withRetryCount(2)
        .build();

      expect(session.lastEscalation).toBeNull();

      const ctx: GuardContext = {
        complexityTier: "F-lite",
        retryCount: 2,
        maxRetries: 2,
        allSlicesClosed: false,
        lastError: null,
        failurePolicy: "strict",
      };

      session.trigger("fail", ctx, new Date());

      expect(session.lastEscalation).not.toBeNull();
      expect(session.lastEscalation?.sliceId).toBe(sliceId);
      expect(session.lastEscalation?.phase).toBe("executing");
    });
  });
});
