import { describe, expect, it } from "vitest";
import { InvalidExecutionSessionStateError } from "./errors/invalid-execution-session-state.error";
import { ExecutionSession } from "./execution-session.aggregate";

const SLICE_ID = crypto.randomUUID();
const MILESTONE_ID = crypto.randomUUID();
const NOW = new Date("2026-03-30T12:00:00Z");

function createSession(): ExecutionSession {
  return ExecutionSession.createNew({
    id: crypto.randomUUID(),
    sliceId: SLICE_ID,
    milestoneId: MILESTONE_ID,
    now: NOW,
  });
}

describe("ExecutionSession", () => {
  describe("createNew", () => {
    it("creates session in 'created' status", () => {
      const session = createSession();
      expect(session.status).toBe("created");
      expect(session.resumeCount).toBe(0);
    });
  });

  describe("start", () => {
    it("transitions created → running", () => {
      const session = createSession();
      session.start(NOW);
      expect(session.status).toBe("running");
      expect(session.signal).toBeDefined();
      expect(session.signal.aborted).toBe(false);
    });

    it("emits ExecutionStartedEvent", () => {
      const session = createSession();
      session.start(NOW);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.started");
    });

    it("returns err from paused", () => {
      const session = createSession();
      session.start(NOW);
      session.confirmPause(NOW);
      const result = session.start(NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(InvalidExecutionSessionStateError);
      }
    });
  });

  describe("requestPause", () => {
    it("aborts the signal", () => {
      const session = createSession();
      session.start(NOW);
      session.requestPause();
      expect(session.signal.aborted).toBe(true);
      expect(session.isPauseRequested).toBe(true);
    });

    it("is idempotent", () => {
      const session = createSession();
      session.start(NOW);
      session.requestPause();
      session.requestPause(); // no throw
      expect(session.isPauseRequested).toBe(true);
    });

    it("no-ops from created (late signal safety)", () => {
      const session = createSession();
      session.requestPause(); // no throw, no effect
      expect(session.status).toBe("created");
    });
  });

  describe("confirmPause", () => {
    it("transitions running → paused", () => {
      const session = createSession();
      session.start(NOW);
      session.confirmPause(NOW);
      expect(session.status).toBe("paused");
    });

    it("emits ExecutionPausedEvent", () => {
      const session = createSession();
      session.start(NOW);
      session.pullEvents(); // clear start event
      session.confirmPause(NOW);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.paused");
    });
  });

  describe("resume", () => {
    it("transitions paused → running with fresh signal", () => {
      const session = createSession();
      session.start(NOW);
      const oldSignal = session.signal;
      session.confirmPause(NOW);
      session.resume(NOW);
      expect(session.status).toBe("running");
      expect(session.signal).not.toBe(oldSignal);
      expect(session.signal.aborted).toBe(false);
      expect(session.resumeCount).toBe(1);
    });

    it("emits ExecutionResumedEvent", () => {
      const session = createSession();
      session.start(NOW);
      session.confirmPause(NOW);
      session.pullEvents(); // clear
      session.resume(NOW);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.resumed");
    });

    it("returns err from running", () => {
      const session = createSession();
      session.start(NOW);
      const result = session.resume(NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(InvalidExecutionSessionStateError);
      }
    });
  });

  describe("complete", () => {
    it("transitions running → completed with wave data", () => {
      const session = createSession();
      session.start(NOW);
      session.complete(NOW, 3, 3);
      expect(session.status).toBe("completed");
    });

    it("emits ExecutionCompletedEvent with wave data", () => {
      const session = createSession();
      session.start(NOW);
      session.pullEvents();
      session.complete(NOW, 3, 4);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.completed");
    });
  });

  describe("fail", () => {
    it("transitions running → failed with reason and wave data", () => {
      const session = createSession();
      session.start(NOW);
      session.fail("timeout", NOW, 1, 3);
      expect(session.status).toBe("failed");
      expect(session.failureReason).toBe("timeout");
    });

    it("emits ExecutionFailedEvent", () => {
      const session = createSession();
      session.start(NOW);
      session.pullEvents();
      session.fail("timeout", NOW);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("execution.failed");
    });
  });

  describe("reconstitute", () => {
    it("restores state from props", () => {
      const session = createSession();
      session.start(NOW);
      const props = session.toJSON();
      const restored = ExecutionSession.reconstitute(props);
      expect(restored.status).toBe("running");
      expect(restored.signal.aborted).toBe(false); // fresh AbortController
      expect(restored.isPauseRequested).toBe(false);
    });
  });

  describe("canResume", () => {
    it("true when paused", () => {
      const session = createSession();
      session.start(NOW);
      session.confirmPause(NOW);
      expect(session.canResume).toBe(true);
    });

    it("false when running", () => {
      const session = createSession();
      session.start(NOW);
      expect(session.canResume).toBe(false);
    });
  });
});
