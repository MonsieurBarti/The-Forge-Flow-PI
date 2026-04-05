import { describe, expect, it } from "vitest";
import { FallbackStrategySchema, ModelResolutionSchema } from "./fallback.schemas";

describe("FallbackStrategySchema", () => {
  it("applies all defaults from an empty object", () => {
    const result = FallbackStrategySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retryCount).toBe(1);
      expect(result.data.downshiftChain).toEqual(["quality", "balanced", "budget"]);
      expect(result.data.checkpointBeforeRetry).toBe(true);
    }
  });

  it("validates with explicit values", () => {
    const result = FallbackStrategySchema.safeParse({
      retryCount: 3,
      downshiftChain: ["premium", "standard"],
      checkpointBeforeRetry: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retryCount).toBe(3);
      expect(result.data.downshiftChain).toEqual(["premium", "standard"]);
      expect(result.data.checkpointBeforeRetry).toBe(false);
    }
  });

  it("rejects retryCount above 3", () => {
    const result = FallbackStrategySchema.safeParse({ retryCount: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects negative retryCount", () => {
    const result = FallbackStrategySchema.safeParse({ retryCount: -1 });
    expect(result.success).toBe(false);
  });
});

describe("ModelResolutionSchema", () => {
  it("validates retry action", () => {
    const result = ModelResolutionSchema.safeParse({
      action: "retry",
      profile: "quality",
      attempt: 1,
    });
    expect(result.success).toBe(true);
  });

  it("validates downshift action", () => {
    const result = ModelResolutionSchema.safeParse({
      action: "downshift",
      profile: "balanced",
      attempt: 2,
    });
    expect(result.success).toBe(true);
  });

  it("validates escalate action", () => {
    const result = ModelResolutionSchema.safeParse({
      action: "escalate",
      profile: "quality",
      attempt: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = ModelResolutionSchema.safeParse({
      action: "abort",
      profile: "quality",
      attempt: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty profile", () => {
    const result = ModelResolutionSchema.safeParse({
      action: "retry",
      profile: "",
      attempt: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative attempt", () => {
    const result = ModelResolutionSchema.safeParse({
      action: "retry",
      profile: "quality",
      attempt: -1,
    });
    expect(result.success).toBe(false);
  });
});
