import { describe, expect, it } from "vitest";
import { TaskDependencyInputSchema, WaveSchema } from "./wave.schemas";

describe("TaskDependencyInputSchema", () => {
  it("accepts valid input with blockedBy", () => {
    const result = TaskDependencyInputSchema.safeParse({
      id: crypto.randomUUID(),
      blockedBy: [crypto.randomUUID()],
    });
    expect(result.success).toBe(true);
  });

  it("defaults blockedBy to empty array when omitted", () => {
    const result = TaskDependencyInputSchema.safeParse({
      id: crypto.randomUUID(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockedBy).toEqual([]);
    }
  });

  it("rejects malformed id", () => {
    const result = TaskDependencyInputSchema.safeParse({
      id: "not-a-uuid",
      blockedBy: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("WaveSchema", () => {
  it("accepts valid wave", () => {
    const result = WaveSchema.safeParse({
      index: 0,
      taskIds: [crypto.randomUUID()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative index", () => {
    const result = WaveSchema.safeParse({
      index: -1,
      taskIds: [crypto.randomUUID()],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty taskIds", () => {
    const result = WaveSchema.safeParse({
      index: 0,
      taskIds: [],
    });
    expect(result.success).toBe(false);
  });
});
