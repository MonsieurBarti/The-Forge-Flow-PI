import { describe, expect, it } from "vitest";
import { CheckpointPropsSchema, ExecutorLogEntrySchema } from "./checkpoint.schemas";

describe("ExecutorLogEntrySchema", () => {
  const validEntry = {
    taskId: crypto.randomUUID(),
    agentIdentity: "opus",
    startedAt: new Date(),
    completedAt: null,
  };

  it("parses valid entry", () => {
    expect(ExecutorLogEntrySchema.parse(validEntry)).toEqual(validEntry);
  });

  it("rejects empty agentIdentity", () => {
    expect(() => ExecutorLogEntrySchema.parse({ ...validEntry, agentIdentity: "" })).toThrow();
  });

  it("accepts non-null completedAt", () => {
    const entry = { ...validEntry, completedAt: new Date() };
    expect(ExecutorLogEntrySchema.parse(entry).completedAt).toBeInstanceOf(Date);
  });

  it("defaults completedAt to null when omitted", () => {
    const { completedAt: _, ...noCompleted } = validEntry;
    expect(ExecutorLogEntrySchema.parse(noCompleted).completedAt).toBeNull();
  });

  it("rejects invalid taskId", () => {
    expect(() => ExecutorLogEntrySchema.parse({ ...validEntry, taskId: "not-uuid" })).toThrow();
  });
});

describe("CheckpointPropsSchema", () => {
  const validProps = {
    id: crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    baseCommit: "abc123f",
    currentWaveIndex: 0,
    completedWaves: [] as number[],
    completedTasks: [] as string[],
    executorLog: [] as unknown[],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("parses valid props", () => {
    const result = CheckpointPropsSchema.parse(validProps);
    expect(result.id).toBe(validProps.id);
    expect(result.version).toBe(1);
  });

  it("defaults version to 1", () => {
    const result = CheckpointPropsSchema.parse(validProps);
    expect(result.version).toBe(1);
  });

  it("accepts explicit version", () => {
    const result = CheckpointPropsSchema.parse({ ...validProps, version: 2 });
    expect(result.version).toBe(2);
  });

  it("rejects empty baseCommit", () => {
    expect(() => CheckpointPropsSchema.parse({ ...validProps, baseCommit: "" })).toThrow();
  });

  it("rejects negative currentWaveIndex", () => {
    expect(() => CheckpointPropsSchema.parse({ ...validProps, currentWaveIndex: -1 })).toThrow();
  });

  it("rejects non-integer currentWaveIndex", () => {
    expect(() => CheckpointPropsSchema.parse({ ...validProps, currentWaveIndex: 1.5 })).toThrow();
  });

  it("accepts non-empty executorLog", () => {
    const result = CheckpointPropsSchema.parse({
      ...validProps,
      executorLog: [
        {
          taskId: crypto.randomUUID(),
          agentIdentity: "opus",
          startedAt: new Date(),
          completedAt: null,
        },
      ],
    });
    expect(result.executorLog).toHaveLength(1);
  });

  it("accepts non-empty completedWaves and completedTasks", () => {
    const result = CheckpointPropsSchema.parse({
      ...validProps,
      completedWaves: [0, 1],
      completedTasks: [crypto.randomUUID()],
    });
    expect(result.completedWaves).toEqual([0, 1]);
    expect(result.completedTasks).toHaveLength(1);
  });
});
