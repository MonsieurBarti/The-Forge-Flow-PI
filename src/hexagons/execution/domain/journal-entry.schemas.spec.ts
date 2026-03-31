import { describe, expect, it } from "vitest";
import {
  ArtifactWrittenEntrySchema,
  CheckpointSavedEntrySchema,
  FileWrittenEntrySchema,
  JournalEntrySchema,
  OverseerInterventionEntrySchema,
  PhaseChangedEntrySchema,
  TaskCompletedEntrySchema,
  TaskFailedEntrySchema,
  TaskStartedEntrySchema,
} from "./journal-entry.schemas";

// ---------------------------------------------------------------------------
// Shared base fields used across all entry types
// ---------------------------------------------------------------------------
const baseFields = {
  seq: 0,
  sliceId: crypto.randomUUID(),
  timestamp: new Date(),
};

// ---------------------------------------------------------------------------
// TaskStartedEntrySchema
// ---------------------------------------------------------------------------
describe("TaskStartedEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "task-started" as const,
    taskId: crypto.randomUUID(),
    waveIndex: 0,
    agentIdentity: "claude-opus",
  };

  it("parses a valid task-started entry", () => {
    const result = TaskStartedEntrySchema.parse(valid);
    expect(result.type).toBe("task-started");
    expect(result.agentIdentity).toBe("claude-opus");
  });

  it("rejects empty agentIdentity", () => {
    expect(() => TaskStartedEntrySchema.parse({ ...valid, agentIdentity: "" })).toThrow();
  });

  it("rejects negative waveIndex", () => {
    expect(() => TaskStartedEntrySchema.parse({ ...valid, waveIndex: -1 })).toThrow();
  });

  it("rejects non-integer waveIndex", () => {
    expect(() => TaskStartedEntrySchema.parse({ ...valid, waveIndex: 1.5 })).toThrow();
  });

  it("rejects invalid taskId", () => {
    expect(() => TaskStartedEntrySchema.parse({ ...valid, taskId: "not-uuid" })).toThrow();
  });

  it("accepts optional correlationId", () => {
    const result = TaskStartedEntrySchema.parse({ ...valid, correlationId: crypto.randomUUID() });
    expect(result.correlationId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TaskCompletedEntrySchema
// ---------------------------------------------------------------------------
describe("TaskCompletedEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "task-completed" as const,
    taskId: crypto.randomUUID(),
    waveIndex: 1,
    durationMs: 3000,
  };

  it("parses a valid task-completed entry", () => {
    const result = TaskCompletedEntrySchema.parse(valid);
    expect(result.type).toBe("task-completed");
    expect(result.durationMs).toBe(3000);
  });

  it("accepts optional commitHash", () => {
    const result = TaskCompletedEntrySchema.parse({ ...valid, commitHash: "abc123f" });
    expect(result.commitHash).toBe("abc123f");
  });

  it("rejects negative durationMs", () => {
    expect(() => TaskCompletedEntrySchema.parse({ ...valid, durationMs: -1 })).toThrow();
  });

  it("rejects non-integer durationMs", () => {
    expect(() => TaskCompletedEntrySchema.parse({ ...valid, durationMs: 1.5 })).toThrow();
  });

  it("rejects missing durationMs", () => {
    const { durationMs: _, ...noDuration } = valid;
    expect(() => TaskCompletedEntrySchema.parse(noDuration)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TaskFailedEntrySchema
// ---------------------------------------------------------------------------
describe("TaskFailedEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "task-failed" as const,
    taskId: crypto.randomUUID(),
    waveIndex: 0,
    errorCode: "TIMEOUT",
    errorMessage: "Agent timed out after 30s",
    retryable: true,
  };

  it("parses a valid task-failed entry", () => {
    const result = TaskFailedEntrySchema.parse(valid);
    expect(result.type).toBe("task-failed");
    expect(result.retryable).toBe(true);
  });

  it("rejects missing errorCode", () => {
    const { errorCode: _, ...noCode } = valid;
    expect(() => TaskFailedEntrySchema.parse(noCode)).toThrow();
  });

  it("rejects missing errorMessage", () => {
    const { errorMessage: _, ...noMsg } = valid;
    expect(() => TaskFailedEntrySchema.parse(noMsg)).toThrow();
  });

  it("rejects missing retryable", () => {
    const { retryable: _, ...noRetryable } = valid;
    expect(() => TaskFailedEntrySchema.parse(noRetryable)).toThrow();
  });

  it("accepts retryable = false", () => {
    const result = TaskFailedEntrySchema.parse({ ...valid, retryable: false });
    expect(result.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FileWrittenEntrySchema
// ---------------------------------------------------------------------------
describe("FileWrittenEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "file-written" as const,
    taskId: crypto.randomUUID(),
    filePath: "src/foo/bar.ts",
    operation: "created" as const,
  };

  it("parses a valid file-written entry with 'created'", () => {
    const result = FileWrittenEntrySchema.parse(valid);
    expect(result.type).toBe("file-written");
    expect(result.operation).toBe("created");
  });

  it("parses operation 'modified'", () => {
    expect(FileWrittenEntrySchema.parse({ ...valid, operation: "modified" }).operation).toBe(
      "modified",
    );
  });

  it("parses operation 'deleted'", () => {
    expect(FileWrittenEntrySchema.parse({ ...valid, operation: "deleted" }).operation).toBe(
      "deleted",
    );
  });

  it("rejects invalid operation value", () => {
    expect(() => FileWrittenEntrySchema.parse({ ...valid, operation: "renamed" })).toThrow();
  });

  it("rejects empty filePath", () => {
    expect(() => FileWrittenEntrySchema.parse({ ...valid, filePath: "" })).toThrow();
  });

  it("rejects missing filePath", () => {
    const { filePath: _, ...noPath } = valid;
    expect(() => FileWrittenEntrySchema.parse(noPath)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CheckpointSavedEntrySchema
// ---------------------------------------------------------------------------
describe("CheckpointSavedEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "checkpoint-saved" as const,
    waveIndex: 2,
    completedTaskCount: 5,
  };

  it("parses a valid checkpoint-saved entry", () => {
    const result = CheckpointSavedEntrySchema.parse(valid);
    expect(result.type).toBe("checkpoint-saved");
    expect(result.completedTaskCount).toBe(5);
  });

  it("rejects negative completedTaskCount", () => {
    expect(() => CheckpointSavedEntrySchema.parse({ ...valid, completedTaskCount: -1 })).toThrow();
  });

  it("rejects non-integer completedTaskCount", () => {
    expect(() => CheckpointSavedEntrySchema.parse({ ...valid, completedTaskCount: 2.5 })).toThrow();
  });

  it("rejects missing waveIndex", () => {
    const { waveIndex: _, ...noWave } = valid;
    expect(() => CheckpointSavedEntrySchema.parse(noWave)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PhaseChangedEntrySchema
// ---------------------------------------------------------------------------
describe("PhaseChangedEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "phase-changed" as const,
    from: "executing",
    to: "verifying",
  };

  it("parses a valid phase-changed entry", () => {
    const result = PhaseChangedEntrySchema.parse(valid);
    expect(result.type).toBe("phase-changed");
    expect(result.from).toBe("executing");
    expect(result.to).toBe("verifying");
  });

  it("rejects missing 'from'", () => {
    const { from: _, ...noFrom } = valid;
    expect(() => PhaseChangedEntrySchema.parse(noFrom)).toThrow();
  });

  it("rejects missing 'to'", () => {
    const { to: _, ...noTo } = valid;
    expect(() => PhaseChangedEntrySchema.parse(noTo)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ArtifactWrittenEntrySchema
// ---------------------------------------------------------------------------
describe("ArtifactWrittenEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "artifact-written" as const,
    artifactPath: "docs/spec.md",
    artifactType: "spec" as const,
  };

  it("parses a valid artifact-written entry with type 'spec'", () => {
    const result = ArtifactWrittenEntrySchema.parse(valid);
    expect(result.type).toBe("artifact-written");
    expect(result.artifactType).toBe("spec");
  });

  it("parses artifactType 'plan'", () => {
    expect(ArtifactWrittenEntrySchema.parse({ ...valid, artifactType: "plan" }).artifactType).toBe(
      "plan",
    );
  });

  it("parses artifactType 'research'", () => {
    expect(
      ArtifactWrittenEntrySchema.parse({ ...valid, artifactType: "research" }).artifactType,
    ).toBe("research");
  });

  it("parses artifactType 'checkpoint'", () => {
    expect(
      ArtifactWrittenEntrySchema.parse({ ...valid, artifactType: "checkpoint" }).artifactType,
    ).toBe("checkpoint");
  });

  it("rejects invalid artifactType", () => {
    expect(() => ArtifactWrittenEntrySchema.parse({ ...valid, artifactType: "notes" })).toThrow();
  });

  it("rejects empty artifactPath", () => {
    expect(() => ArtifactWrittenEntrySchema.parse({ ...valid, artifactPath: "" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// JournalEntrySchema (discriminated union)
// ---------------------------------------------------------------------------
describe("JournalEntrySchema", () => {
  it("routes task-started correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "task-started",
      taskId: crypto.randomUUID(),
      waveIndex: 0,
      agentIdentity: "agent-1",
    });
    expect(entry.type).toBe("task-started");
  });

  it("routes task-completed correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "task-completed",
      taskId: crypto.randomUUID(),
      waveIndex: 0,
      durationMs: 1000,
    });
    expect(entry.type).toBe("task-completed");
  });

  it("routes task-failed correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "task-failed",
      taskId: crypto.randomUUID(),
      waveIndex: 0,
      errorCode: "ERR",
      errorMessage: "something failed",
      retryable: false,
    });
    expect(entry.type).toBe("task-failed");
  });

  it("routes file-written correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "file-written",
      taskId: crypto.randomUUID(),
      filePath: "src/x.ts",
      operation: "modified",
    });
    expect(entry.type).toBe("file-written");
  });

  it("routes checkpoint-saved correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "checkpoint-saved",
      waveIndex: 0,
      completedTaskCount: 3,
    });
    expect(entry.type).toBe("checkpoint-saved");
  });

  it("routes phase-changed correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "phase-changed",
      from: "planning",
      to: "executing",
    });
    expect(entry.type).toBe("phase-changed");
  });

  it("routes artifact-written correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "artifact-written",
      artifactPath: "docs/plan.md",
      artifactType: "plan",
    });
    expect(entry.type).toBe("artifact-written");
  });

  it("throws on unknown type discriminator", () => {
    expect(() =>
      JournalEntrySchema.parse({
        ...baseFields,
        type: "unknown-event",
      }),
    ).toThrow();
  });

  it("throws when seq is negative", () => {
    expect(() =>
      JournalEntrySchema.parse({
        ...baseFields,
        seq: -1,
        type: "phase-changed",
        from: "a",
        to: "b",
      }),
    ).toThrow();
  });

  it("throws when seq is non-integer", () => {
    expect(() =>
      JournalEntrySchema.parse({
        ...baseFields,
        seq: 0.5,
        type: "phase-changed",
        from: "a",
        to: "b",
      }),
    ).toThrow();
  });

  it("accepts seq = 0", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      seq: 0,
      type: "phase-changed",
      from: "a",
      to: "b",
    });
    expect(entry.seq).toBe(0);
  });

  it("routes overseer-intervention correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "overseer-intervention",
      taskId: crypto.randomUUID(),
      strategy: "timeout",
      reason: "timed out",
      action: "aborted",
      retryCount: 0,
    });
    expect(entry.type).toBe("overseer-intervention");
  });
});

// ---------------------------------------------------------------------------
// OverseerInterventionEntrySchema
// ---------------------------------------------------------------------------
describe("OverseerInterventionEntrySchema", () => {
  it("accepts a valid intervention entry", () => {
    const result = OverseerInterventionEntrySchema.safeParse({
      seq: 0,
      sliceId: crypto.randomUUID(),
      timestamp: new Date(),
      type: "overseer-intervention",
      taskId: crypto.randomUUID(),
      strategy: "timeout",
      reason: "Task exceeded S timeout of 300000ms",
      action: "aborted",
      retryCount: 0,
    });
    expect(result.success).toBe(true);
  });
  it("accepts all action variants", () => {
    for (const action of ["aborted", "retrying", "escalated"]) {
      const result = OverseerInterventionEntrySchema.safeParse({
        seq: 1,
        sliceId: crypto.randomUUID(),
        timestamp: new Date(),
        type: "overseer-intervention",
        taskId: crypto.randomUUID(),
        strategy: "timeout",
        reason: "timeout",
        action,
        retryCount: 1,
      });
      expect(result.success).toBe(true);
    }
  });
});
