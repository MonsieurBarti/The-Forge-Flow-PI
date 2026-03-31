import { describe, expect, it } from "vitest";
import {
  InterventionActionSchema,
  OverseerConfigSchema,
  OverseerContextSchema,
  OverseerVerdictSchema,
  RetryDecisionSchema,
} from "./overseer.schemas";

describe("OverseerVerdictSchema", () => {
  it("accepts a valid verdict", () => {
    const result = OverseerVerdictSchema.safeParse({
      strategy: "timeout",
      reason: "Task exceeded S timeout of 300000ms",
    });
    expect(result.success).toBe(true);
  });
  it("rejects empty strategy", () => {
    expect(OverseerVerdictSchema.safeParse({ strategy: "", reason: "x" }).success).toBe(false);
  });
});

describe("OverseerContextSchema", () => {
  it("accepts a valid context", () => {
    const result = OverseerContextSchema.safeParse({
      taskId: crypto.randomUUID(),
      sliceId: crypto.randomUUID(),
      complexityTier: "F-lite",
      dispatchTimestamp: new Date(),
    });
    expect(result.success).toBe(true);
  });
  it("rejects invalid tier", () => {
    const result = OverseerContextSchema.safeParse({
      taskId: crypto.randomUUID(),
      sliceId: crypto.randomUUID(),
      complexityTier: "XL",
      dispatchTimestamp: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

describe("OverseerConfigSchema", () => {
  it("accepts full config", () => {
    const result = OverseerConfigSchema.safeParse({
      enabled: true,
      timeouts: { S: 300000, "F-lite": 900000, "F-full": 1800000 },
      retryLoop: { threshold: 3 },
    });
    expect(result.success).toBe(true);
  });
  it("provides defaults", () => {
    const result = OverseerConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.timeouts.S).toBe(300000);
    }
  });
});

describe("RetryDecisionSchema", () => {
  it("accepts retry=true", () => {
    const result = RetryDecisionSchema.safeParse({ retry: true, reason: "attempt 1 of 2" });
    expect(result.success).toBe(true);
  });
});

describe("InterventionActionSchema", () => {
  it("accepts all valid actions", () => {
    for (const action of ["aborted", "retrying", "escalated"]) {
      expect(InterventionActionSchema.safeParse(action).success).toBe(true);
    }
  });
});
