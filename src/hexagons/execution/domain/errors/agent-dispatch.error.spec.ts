import { describe, expect, it } from "vitest";
import { AgentDispatchError } from "./agent-dispatch.error";

describe("AgentDispatchError", () => {
  it("sessionCreationFailed includes taskId and cause", () => {
    const error = AgentDispatchError.sessionCreationFailed("task-1", new Error("boom"));
    expect(error.code).toBe("AGENT_DISPATCH.SESSION_CREATION_FAILED");
    expect(error.message).toContain("task-1");
    expect(error.message).toContain("boom");
    expect(error.metadata?.taskId).toBe("task-1");
  });

  it("sessionTimedOut includes taskId and duration", () => {
    const error = AgentDispatchError.sessionTimedOut("task-1", 30000);
    expect(error.code).toBe("AGENT_DISPATCH.SESSION_TIMED_OUT");
    expect(error.metadata?.durationMs).toBe(30000);
  });

  it("sessionAborted includes taskId", () => {
    const error = AgentDispatchError.sessionAborted("task-1");
    expect(error.code).toBe("AGENT_DISPATCH.SESSION_ABORTED");
    expect(error.metadata?.taskId).toBe("task-1");
  });

  it("unexpectedFailure includes taskId and cause", () => {
    const error = AgentDispatchError.unexpectedFailure("task-1", "unknown");
    expect(error.code).toBe("AGENT_DISPATCH.UNEXPECTED_FAILURE");
    expect(error.metadata?.taskId).toBe("task-1");
  });

  it("extends Error", () => {
    const error = AgentDispatchError.sessionAborted("task-1");
    expect(error).toBeInstanceOf(Error);
  });
});
