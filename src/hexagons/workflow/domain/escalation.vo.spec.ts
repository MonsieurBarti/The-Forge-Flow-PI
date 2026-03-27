import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { Escalation } from "./escalation.vo";

describe("Escalation", () => {
  describe("create", () => {
    it("creates an escalation with provided props", () => {
      const props = {
        sliceId: faker.string.uuid(),
        phase: "planning" as const,
        reason: "Retries exhausted",
        attempts: 3,
        lastError: "Guard rejected",
        occurredAt: new Date(),
      };
      const escalation = Escalation.create(props);
      expect(escalation.sliceId).toBe(props.sliceId);
      expect(escalation.phase).toBe("planning");
      expect(escalation.attempts).toBe(3);
      expect(escalation.lastError).toBe("Guard rejected");
    });
  });

  describe("fromRetryExhaustion", () => {
    it("creates escalation with correct reason and summary", () => {
      const sliceId = faker.string.uuid();
      const escalation = Escalation.fromRetryExhaustion(sliceId, "planning", 3, "Last error msg");
      expect(escalation.sliceId).toBe(sliceId);
      expect(escalation.phase).toBe("planning");
      expect(escalation.attempts).toBe(3);
      expect(escalation.reason).toContain("Retries exhausted");
      expect(escalation.lastError).toBe("Last error msg");
      expect(escalation.occurredAt).toBeInstanceOf(Date);
    });

    it("creates escalation with null lastError", () => {
      const escalation = Escalation.fromRetryExhaustion(faker.string.uuid(), "verifying", 2, null);
      expect(escalation.lastError).toBeNull();
      expect(escalation.attempts).toBe(2);
    });

    it("produces a human-readable summary", () => {
      const sliceId = faker.string.uuid();
      const escalation = Escalation.fromRetryExhaustion(sliceId, "planning", 3, null);
      expect(escalation.summary).toBe(`Slice ${sliceId}: blocked at planning after 3 attempts`);
    });
  });

  describe("toProps", () => {
    it("returns a plain copy of the props", () => {
      const sliceId = faker.string.uuid();
      const escalation = Escalation.fromRetryExhaustion(sliceId, "planning", 3, null);
      const plain = escalation.toProps;
      expect(plain.sliceId).toBe(sliceId);
      expect(plain.phase).toBe("planning");
      expect(plain.attempts).toBe(3);
    });
  });

  describe("equals", () => {
    it("returns true for same props", () => {
      const props = {
        sliceId: faker.string.uuid(),
        phase: "planning" as const,
        reason: "Retries exhausted",
        attempts: 3,
        lastError: null,
        occurredAt: new Date("2026-01-01"),
      };
      expect(Escalation.create(props).equals(Escalation.create(props))).toBe(true);
    });
  });
});
