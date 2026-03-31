import { describe, expect, it } from "vitest";
import {
  ExecutionSessionPropsSchema,
  ExecutionSessionStatusSchema,
} from "./execution-session.schemas";

describe("ExecutionSessionStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["created", "running", "paused", "completed", "failed"]) {
      expect(ExecutionSessionStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects unknown status", () => {
    expect(ExecutionSessionStatusSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("ExecutionSessionPropsSchema", () => {
  const validProps = {
    id: crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    milestoneId: crypto.randomUUID(),
    status: "created",
    resumeCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("accepts valid props", () => {
    expect(ExecutionSessionPropsSchema.safeParse(validProps).success).toBe(true);
  });

  it("accepts props with optional fields", () => {
    const result = ExecutionSessionPropsSchema.safeParse({
      ...validProps,
      status: "failed",
      failureReason: "Journal inconsistency",
      startedAt: new Date(),
      pausedAt: new Date(),
      completedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative resumeCount", () => {
    expect(ExecutionSessionPropsSchema.safeParse({ ...validProps, resumeCount: -1 }).success).toBe(
      false,
    );
  });
});
