import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ExecuteSliceInputSchema, ExecuteSliceResultSchema } from "./execute-slice.schemas";

describe("ExecuteSliceInputSchema", () => {
  const valid = {
    sliceId: randomUUID(),
    milestoneId: randomUUID(),
    sliceLabel: "M04-S07",
    sliceTitle: "Wave-based execution engine",
    complexity: "F-full" as const,
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    modelProfile: "balanced" as const,
    workingDirectory: "/path/to/worktree",
  };

  it("parses valid input", () => {
    expect(ExecuteSliceInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing sliceLabel", () => {
    const { sliceLabel: _, ...without } = valid;
    expect(ExecuteSliceInputSchema.safeParse(without).success).toBe(false);
  });

  it("rejects empty sliceLabel", () => {
    expect(ExecuteSliceInputSchema.safeParse({ ...valid, sliceLabel: "" }).success).toBe(false);
  });

  it("accepts all complexity tiers", () => {
    for (const tier of ["S", "F-lite", "F-full"]) {
      expect(ExecuteSliceInputSchema.safeParse({ ...valid, complexity: tier }).success).toBe(true);
    }
  });

  it("rejects invalid complexity tier", () => {
    expect(ExecuteSliceInputSchema.safeParse({ ...valid, complexity: "XL" }).success).toBe(false);
  });

  it("rejects invalid model profile", () => {
    expect(ExecuteSliceInputSchema.safeParse({ ...valid, modelProfile: "premium" }).success).toBe(
      false,
    );
  });
});

describe("ExecuteSliceResultSchema", () => {
  it("parses valid result", () => {
    const result = ExecuteSliceResultSchema.safeParse({
      sliceId: randomUUID(),
      completedTasks: [randomUUID()],
      failedTasks: [],
      skippedTasks: [],
      wavesCompleted: 2,
      totalWaves: 2,
      aborted: false,
    });
    expect(result.success).toBe(true);
  });

  it("requires skippedTasks array", () => {
    const result = ExecuteSliceResultSchema.safeParse({
      sliceId: randomUUID(),
      completedTasks: [],
      failedTasks: [],
      wavesCompleted: 0,
      totalWaves: 1,
      aborted: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative wavesCompleted", () => {
    expect(
      ExecuteSliceResultSchema.safeParse({
        sliceId: randomUUID(),
        completedTasks: [],
        failedTasks: [],
        skippedTasks: [],
        wavesCompleted: -1,
        totalWaves: 1,
        aborted: false,
      }).success,
    ).toBe(false);
  });
});
