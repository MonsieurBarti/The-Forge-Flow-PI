import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import {
  GuardContextSchema,
  GuardNameSchema,
  TransitionEffectSchema,
  TransitionRuleSchema,
  WorkflowPhaseSchema,
  WorkflowSessionPropsSchema,
  WorkflowTriggerSchema,
} from "./workflow-session.schemas";

describe("WorkflowPhaseSchema", () => {
  const validPhases = [
    "idle",
    "discussing",
    "researching",
    "planning",
    "executing",
    "verifying",
    "reviewing",
    "shipping",
    "completing-milestone",
    "paused",
    "blocked",
  ];

  it.each(validPhases)("accepts '%s'", (phase) => {
    expect(WorkflowPhaseSchema.parse(phase)).toBe(phase);
  });

  it("rejects invalid phase", () => {
    expect(() => WorkflowPhaseSchema.parse("coding")).toThrow();
  });
});

describe("WorkflowTriggerSchema", () => {
  const validTriggers = [
    "start",
    "next",
    "skip",
    "back",
    "fail",
    "approve",
    "reject",
    "pause",
    "resume",
    "abort",
  ];

  it.each(validTriggers)("accepts '%s'", (trigger) => {
    expect(WorkflowTriggerSchema.parse(trigger)).toBe(trigger);
  });

  it("rejects invalid trigger", () => {
    expect(() => WorkflowTriggerSchema.parse("restart")).toThrow();
  });
});

describe("WorkflowSessionPropsSchema", () => {
  it("parses valid session props", () => {
    const now = new Date();
    const props = WorkflowSessionPropsSchema.parse({
      id: faker.string.uuid(),
      milestoneId: faker.string.uuid(),
      currentPhase: "idle",
      autonomyMode: "guided",
      createdAt: now,
      updatedAt: now,
    });
    expect(props.currentPhase).toBe("idle");
    expect(props.sliceId).toBeUndefined();
    expect(props.retryCount).toBe(0);
  });

  it("parses session with active slice", () => {
    const now = new Date();
    const props = WorkflowSessionPropsSchema.parse({
      id: faker.string.uuid(),
      milestoneId: faker.string.uuid(),
      sliceId: faker.string.uuid(),
      currentPhase: "executing",
      previousPhase: "planning",
      autonomyMode: "plan-to-pr",
      retryCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(props.sliceId).toBeDefined();
    expect(props.previousPhase).toBe("planning");
    expect(props.retryCount).toBe(1);
  });

  it("rejects invalid autonomy mode", () => {
    expect(() =>
      WorkflowSessionPropsSchema.parse({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        currentPhase: "idle",
        autonomyMode: "yolo",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow();
  });
});

describe("GuardNameSchema", () => {
  const validGuards = ["notSTier", "isSTier", "allSlicesClosed", "retriesExhausted"];

  it.each(validGuards)("accepts '%s'", (guard) => {
    expect(GuardNameSchema.parse(guard)).toBe(guard);
  });

  it("rejects invalid guard name", () => {
    expect(() => GuardNameSchema.parse("invalidGuard")).toThrow();
  });
});

describe("TransitionEffectSchema", () => {
  const validEffects = [
    "incrementRetry",
    "savePreviousPhase",
    "restorePreviousPhase",
    "resetRetryCount",
    "clearSlice",
  ];

  it.each(validEffects)("accepts '%s'", (effect) => {
    expect(TransitionEffectSchema.parse(effect)).toBe(effect);
  });

  it("rejects invalid effect", () => {
    expect(() => TransitionEffectSchema.parse("doSomething")).toThrow();
  });
});

describe("GuardContextSchema", () => {
  it("parses valid guard context", () => {
    const ctx = GuardContextSchema.parse({
      complexityTier: "F-lite",
      retryCount: 2,
      maxRetries: 3,
      allSlicesClosed: false,
    });
    expect(ctx.complexityTier).toBe("F-lite");
    expect(ctx.retryCount).toBe(2);
    expect(ctx.maxRetries).toBe(3);
    expect(ctx.allSlicesClosed).toBe(false);
  });

  it("accepts null complexityTier", () => {
    const ctx = GuardContextSchema.parse({
      complexityTier: null,
      retryCount: 0,
      maxRetries: 3,
      allSlicesClosed: true,
    });
    expect(ctx.complexityTier).toBeNull();
  });

  it("parses with failurePolicy: 'lenient'", () => {
    const ctx = GuardContextSchema.parse({
      complexityTier: "F-lite",
      retryCount: 0,
      maxRetries: 3,
      allSlicesClosed: false,
      failurePolicy: "lenient",
    });
    expect(ctx.failurePolicy).toBe("lenient");
  });

  it("defaults failurePolicy to 'strict' when omitted", () => {
    const ctx = GuardContextSchema.parse({
      complexityTier: "F-lite",
      retryCount: 0,
      maxRetries: 3,
      allSlicesClosed: false,
    });
    expect(ctx.failurePolicy).toBe("strict");
  });
});

describe("TransitionRuleSchema", () => {
  it("parses a rule with guard and effects", () => {
    const rule = TransitionRuleSchema.parse({
      from: "executing",
      trigger: "fail",
      to: "blocked",
      guard: "retriesExhausted",
      effects: ["incrementRetry", "savePreviousPhase"],
    });
    expect(rule.from).toBe("executing");
    expect(rule.guard).toBe("retriesExhausted");
    expect(rule.effects).toEqual(["incrementRetry", "savePreviousPhase"]);
  });

  it("accepts '*active*' as from", () => {
    const rule = TransitionRuleSchema.parse({
      from: "*active*",
      trigger: "pause",
      to: "paused",
    });
    expect(rule.from).toBe("*active*");
  });

  it("accepts '*previousPhase*' as to", () => {
    const rule = TransitionRuleSchema.parse({
      from: "paused",
      trigger: "resume",
      to: "*previousPhase*",
    });
    expect(rule.to).toBe("*previousPhase*");
  });

  it("defaults effects to empty array", () => {
    const rule = TransitionRuleSchema.parse({
      from: "idle",
      trigger: "start",
      to: "discussing",
    });
    expect(rule.effects).toEqual([]);
  });
});
