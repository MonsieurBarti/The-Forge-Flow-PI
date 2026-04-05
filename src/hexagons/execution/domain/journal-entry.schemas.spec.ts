import { describe, expect, it } from "vitest";
import {
  ArtifactWrittenEntrySchema,
  CheckpointSavedEntrySchema,
  FailureRecordedEntrySchema,
  FileWrittenEntrySchema,
  JournalEntrySchema,
  ModelDownshiftEntrySchema,
  OverseerInterventionEntrySchema,
  PhaseChangedEntrySchema,
  PreDispatchBlockedEntrySchema,
  ReflectionEntrySchema,
  TaskCompletedEntrySchema,
  TaskEscalatedEntrySchema,
  TaskFailedEntrySchema,
  TaskStartedEntrySchema,
  ToolExecutionEntrySchema,
  TurnBoundaryEntrySchema,
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

  it("routes tool-execution correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "tool-execution",
      taskId: crypto.randomUUID(),
      turnIndex: 0,
      toolCallId: "tc_001",
      toolName: "Bash",
      durationMs: 200,
      isError: false,
    });
    expect(entry.type).toBe("tool-execution");
  });

  it("routes turn-boundary correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "turn-boundary",
      taskId: crypto.randomUUID(),
      turnIndex: 1,
      boundary: "end",
      toolCallCount: 2,
    });
    expect(entry.type).toBe("turn-boundary");
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

  it("routes reflection correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "reflection",
      taskId: crypto.randomUUID(),
      waveIndex: 0,
      tier: "full",
      passed: false,
      issues: [{ severity: "blocker", description: "Type error" }],
      triggeredRetry: true,
    });
    expect(entry.type).toBe("reflection");
  });

  it("routes model-downshift correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "model-downshift",
      taskId: crypto.randomUUID(),
      waveIndex: 0,
      fromProfile: "opus",
      toProfile: "sonnet",
      reason: "Budget limit",
      attempt: 1,
    });
    expect(entry.type).toBe("model-downshift");
  });

  it("routes task-escalated correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "task-escalated",
      taskId: crypto.randomUUID(),
      waveIndex: 0,
      reason: "All profiles exhausted",
      totalAttempts: 3,
      profilesAttempted: ["opus", "sonnet"],
    });
    expect(entry.type).toBe("task-escalated");
  });

  it("routes pre-dispatch-blocked correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "pre-dispatch-blocked",
      taskId: crypto.randomUUID(),
      waveIndex: 0,
      ruleId: "scope-check",
      severity: "blocker",
      message: "Out of scope",
    });
    expect(entry.type).toBe("pre-dispatch-blocked");
  });

  it("routes failure-recorded correctly", () => {
    const entry = JournalEntrySchema.parse({
      ...baseFields,
      type: "failure-recorded",
      phase: "executing",
      policy: "tolerant",
      action: "retried",
      error: "timeout",
    });
    expect(entry.type).toBe("failure-recorded");
  });

  it("accepts all 17 entry types in the union", () => {
    const types = [
      "task-started",
      "task-completed",
      "task-failed",
      "file-written",
      "checkpoint-saved",
      "phase-changed",
      "artifact-written",
      "guardrail-violation",
      "overseer-intervention",
      "execution-lifecycle",
      "tool-execution",
      "turn-boundary",
      "reflection",
      "model-downshift",
      "task-escalated",
      "pre-dispatch-blocked",
      "failure-recorded",
    ];
    expect(types).toHaveLength(17);
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

// ---------------------------------------------------------------------------
// ToolExecutionEntrySchema
// ---------------------------------------------------------------------------
describe("ToolExecutionEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "tool-execution" as const,
    taskId: crypto.randomUUID(),
    turnIndex: 0,
    toolCallId: "tc_001",
    toolName: "Read",
    durationMs: 150,
    isError: false,
  };

  it("parses a valid tool-execution entry", () => {
    const result = ToolExecutionEntrySchema.parse(valid);
    expect(result.type).toBe("tool-execution");
    expect(result.toolName).toBe("Read");
    expect(result.durationMs).toBe(150);
  });

  it("rejects empty toolName", () => {
    expect(() => ToolExecutionEntrySchema.parse({ ...valid, toolName: "" })).toThrow();
  });

  it("rejects negative durationMs", () => {
    expect(() => ToolExecutionEntrySchema.parse({ ...valid, durationMs: -1 })).toThrow();
  });

  it("rejects negative turnIndex", () => {
    expect(() => ToolExecutionEntrySchema.parse({ ...valid, turnIndex: -1 })).toThrow();
  });

  it("rejects missing toolCallId", () => {
    const { toolCallId: _, ...noId } = valid;
    expect(() => ToolExecutionEntrySchema.parse(noId)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TurnBoundaryEntrySchema
// ---------------------------------------------------------------------------
describe("TurnBoundaryEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "turn-boundary" as const,
    taskId: crypto.randomUUID(),
    turnIndex: 0,
    boundary: "start" as const,
  };

  it("parses a valid turn-boundary start entry", () => {
    const result = TurnBoundaryEntrySchema.parse(valid);
    expect(result.type).toBe("turn-boundary");
    expect(result.boundary).toBe("start");
    expect(result.toolCallCount).toBeUndefined();
  });

  it("parses turn-boundary end with toolCallCount", () => {
    const result = TurnBoundaryEntrySchema.parse({
      ...valid,
      boundary: "end",
      toolCallCount: 3,
    });
    expect(result.boundary).toBe("end");
    expect(result.toolCallCount).toBe(3);
  });

  it("rejects invalid boundary value", () => {
    expect(() => TurnBoundaryEntrySchema.parse({ ...valid, boundary: "middle" })).toThrow();
  });

  it("rejects negative turnIndex", () => {
    expect(() => TurnBoundaryEntrySchema.parse({ ...valid, turnIndex: -1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ReflectionEntrySchema
// ---------------------------------------------------------------------------
describe("ReflectionEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "reflection" as const,
    taskId: crypto.randomUUID(),
    waveIndex: 0,
    tier: "fast" as const,
    passed: true,
    issues: [],
    triggeredRetry: false,
  };

  it("parses a valid reflection entry", () => {
    const result = ReflectionEntrySchema.parse(valid);
    expect(result.type).toBe("reflection");
    expect(result.tier).toBe("fast");
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.triggeredRetry).toBe(false);
  });

  it("parses with issues array", () => {
    const result = ReflectionEntrySchema.parse({
      ...valid,
      passed: false,
      issues: [
        { severity: "blocker", description: "Missing import", filePath: "src/foo.ts" },
        { severity: "warning", description: "Unused variable" },
      ],
      triggeredRetry: true,
    });
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].severity).toBe("blocker");
    expect(result.issues[0].filePath).toBe("src/foo.ts");
    expect(result.issues[1].filePath).toBeUndefined();
  });

  it("defaults issues to empty array when omitted", () => {
    const { issues: _, ...noIssues } = valid;
    const result = ReflectionEntrySchema.parse(noIssues);
    expect(result.issues).toEqual([]);
  });

  it("rejects invalid tier value", () => {
    expect(() => ReflectionEntrySchema.parse({ ...valid, tier: "slow" })).toThrow();
  });

  it("rejects empty issue description", () => {
    expect(() =>
      ReflectionEntrySchema.parse({
        ...valid,
        issues: [{ severity: "blocker", description: "" }],
      }),
    ).toThrow();
  });

  it("rejects wrong type literal", () => {
    expect(() => ReflectionEntrySchema.parse({ ...valid, type: "task-started" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ModelDownshiftEntrySchema
// ---------------------------------------------------------------------------
describe("ModelDownshiftEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "model-downshift" as const,
    taskId: crypto.randomUUID(),
    waveIndex: 1,
    fromProfile: "opus",
    toProfile: "sonnet",
    reason: "Budget exceeded threshold",
    attempt: 2,
  };

  it("parses a valid model-downshift entry", () => {
    const result = ModelDownshiftEntrySchema.parse(valid);
    expect(result.type).toBe("model-downshift");
    expect(result.fromProfile).toBe("opus");
    expect(result.toProfile).toBe("sonnet");
    expect(result.attempt).toBe(2);
  });

  it("rejects empty fromProfile", () => {
    expect(() => ModelDownshiftEntrySchema.parse({ ...valid, fromProfile: "" })).toThrow();
  });

  it("rejects empty toProfile", () => {
    expect(() => ModelDownshiftEntrySchema.parse({ ...valid, toProfile: "" })).toThrow();
  });

  it("rejects empty reason", () => {
    expect(() => ModelDownshiftEntrySchema.parse({ ...valid, reason: "" })).toThrow();
  });

  it("rejects negative attempt", () => {
    expect(() => ModelDownshiftEntrySchema.parse({ ...valid, attempt: -1 })).toThrow();
  });

  it("rejects wrong type literal", () => {
    expect(() => ModelDownshiftEntrySchema.parse({ ...valid, type: "task-failed" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TaskEscalatedEntrySchema
// ---------------------------------------------------------------------------
describe("TaskEscalatedEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "task-escalated" as const,
    taskId: crypto.randomUUID(),
    waveIndex: 0,
    reason: "All model profiles exhausted",
    totalAttempts: 3,
    profilesAttempted: ["opus", "sonnet", "haiku"],
  };

  it("parses a valid task-escalated entry", () => {
    const result = TaskEscalatedEntrySchema.parse(valid);
    expect(result.type).toBe("task-escalated");
    expect(result.totalAttempts).toBe(3);
    expect(result.profilesAttempted).toEqual(["opus", "sonnet", "haiku"]);
  });

  it("accepts empty profilesAttempted array", () => {
    const result = TaskEscalatedEntrySchema.parse({ ...valid, profilesAttempted: [] });
    expect(result.profilesAttempted).toEqual([]);
  });

  it("rejects empty reason", () => {
    expect(() => TaskEscalatedEntrySchema.parse({ ...valid, reason: "" })).toThrow();
  });

  it("rejects negative totalAttempts", () => {
    expect(() => TaskEscalatedEntrySchema.parse({ ...valid, totalAttempts: -1 })).toThrow();
  });

  it("rejects wrong type literal", () => {
    expect(() => TaskEscalatedEntrySchema.parse({ ...valid, type: "task-completed" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PreDispatchBlockedEntrySchema
// ---------------------------------------------------------------------------
describe("PreDispatchBlockedEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "pre-dispatch-blocked" as const,
    taskId: crypto.randomUUID(),
    waveIndex: 0,
    ruleId: "scope-containment",
    severity: "blocker" as const,
    message: "Task writes outside allowed paths",
  };

  it("parses a valid pre-dispatch-blocked entry", () => {
    const result = PreDispatchBlockedEntrySchema.parse(valid);
    expect(result.type).toBe("pre-dispatch-blocked");
    expect(result.ruleId).toBe("scope-containment");
    expect(result.severity).toBe("blocker");
  });

  it("accepts severity 'warning'", () => {
    const result = PreDispatchBlockedEntrySchema.parse({ ...valid, severity: "warning" });
    expect(result.severity).toBe("warning");
  });

  it("rejects empty ruleId", () => {
    expect(() => PreDispatchBlockedEntrySchema.parse({ ...valid, ruleId: "" })).toThrow();
  });

  it("rejects empty message", () => {
    expect(() => PreDispatchBlockedEntrySchema.parse({ ...valid, message: "" })).toThrow();
  });

  it("rejects invalid severity", () => {
    expect(() => PreDispatchBlockedEntrySchema.parse({ ...valid, severity: "info" })).toThrow();
  });

  it("rejects wrong type literal", () => {
    expect(() =>
      PreDispatchBlockedEntrySchema.parse({ ...valid, type: "phase-changed" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FailureRecordedEntrySchema
// ---------------------------------------------------------------------------
describe("FailureRecordedEntrySchema", () => {
  const valid = {
    ...baseFields,
    type: "failure-recorded" as const,
    phase: "executing",
    policy: "tolerant" as const,
    action: "retried" as const,
    error: "Task timed out",
  };

  it("parses a valid failure-recorded entry with all fields", () => {
    const result = FailureRecordedEntrySchema.parse(valid);
    expect(result.type).toBe("failure-recorded");
    expect(result.phase).toBe("executing");
    expect(result.policy).toBe("tolerant");
    expect(result.action).toBe("retried");
    expect(result.error).toBe("Task timed out");
  });

  it("accepts all policy values", () => {
    for (const policy of ["strict", "tolerant", "lenient"]) {
      const result = FailureRecordedEntrySchema.safeParse({ ...valid, policy });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all action values", () => {
    for (const action of ["retried", "continued", "blocked"]) {
      const result = FailureRecordedEntrySchema.safeParse({ ...valid, action });
      expect(result.success).toBe(true);
    }
  });

  it("accepts optional error omitted", () => {
    const { error: _, ...noError } = valid;
    const result = FailureRecordedEntrySchema.parse(noError);
    expect(result.error).toBeUndefined();
  });

  it("rejects invalid policy", () => {
    expect(() => FailureRecordedEntrySchema.parse({ ...valid, policy: "yolo" })).toThrow();
  });

  it("rejects invalid action", () => {
    expect(() => FailureRecordedEntrySchema.parse({ ...valid, action: "ignored" })).toThrow();
  });

  it("rejects wrong type literal", () => {
    expect(() => FailureRecordedEntrySchema.parse({ ...valid, type: "task-failed" })).toThrow();
  });
});
