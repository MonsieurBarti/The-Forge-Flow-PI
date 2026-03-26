import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import {
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
