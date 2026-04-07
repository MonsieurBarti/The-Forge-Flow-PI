import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { ReviewRecordedEvent } from "../events/review-recorded.event";
import { Review } from "./review.aggregate";

const sliceId = faker.string.uuid();
const now = new Date();

describe("Review", () => {
  describe("createNew", () => {
    it("creates with approved verdict and empty findings (AC1)", () => {
      const review = Review.createNew({
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer",
        agentIdentity: "agent-1",
        now,
      });
      expect(review.verdict).toBe("approved");
      expect(review.findings).toEqual([]);
    });

    it("emits ReviewRecordedEvent on creation (AC1)", () => {
      const review = Review.createNew({
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer",
        agentIdentity: "agent-1",
        now,
      });
      const events = review.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ReviewRecordedEvent);
    });
  });

  describe("reconstitute", () => {
    it("does NOT emit events (AC5)", () => {
      const review = Review.reconstitute({
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer",
        agentIdentity: "agent-1",
        verdict: "approved",
        findings: [],
        createdAt: now,
        updatedAt: now,
      });
      expect(review.pullEvents()).toHaveLength(0);
    });
  });

  describe("recordFindings", () => {
    it("sets verdict to changes_requested for critical finding (AC2)", () => {
      const review = Review.createNew({
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer",
        agentIdentity: "agent-1",
        now,
      });
      review.pullEvents(); // clear creation event
      const result = review.recordFindings(
        [
          {
            id: faker.string.uuid(),
            severity: "critical",
            message: "SQL injection",
            filePath: "src/api.ts",
            lineStart: 10,
          },
        ],
        now,
      );
      expect(result.ok).toBe(true);
      expect(review.verdict).toBe("changes_requested");
    });

    it("sets verdict to changes_requested for high finding (AC2)", () => {
      const review = Review.createNew({
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer",
        agentIdentity: "agent-1",
        now,
      });
      review.pullEvents();
      review.recordFindings(
        [
          {
            id: faker.string.uuid(),
            severity: "high",
            message: "XSS risk",
            filePath: "src/ui.ts",
            lineStart: 5,
          },
        ],
        now,
      );
      expect(review.verdict).toBe("changes_requested");
    });

    it("keeps verdict as approved for low/info only (AC3)", () => {
      const review = Review.createNew({
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer",
        agentIdentity: "agent-1",
        now,
      });
      review.pullEvents();
      review.recordFindings(
        [
          {
            id: faker.string.uuid(),
            severity: "low",
            message: "Naming",
            filePath: "src/a.ts",
            lineStart: 1,
          },
          {
            id: faker.string.uuid(),
            severity: "info",
            message: "Style",
            filePath: "src/b.ts",
            lineStart: 2,
          },
        ],
        now,
      );
      expect(review.verdict).toBe("approved");
    });

    it("emits ReviewRecordedEvent with updated verdict (AC4)", () => {
      const review = Review.createNew({
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer",
        agentIdentity: "agent-1",
        now,
      });
      review.pullEvents();
      review.recordFindings(
        [
          {
            id: faker.string.uuid(),
            severity: "critical",
            message: "Bad",
            filePath: "src/x.ts",
            lineStart: 1,
          },
        ],
        now,
      );
      const events = review.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as ReviewRecordedEvent;
      expect(event.verdict).toBe("changes_requested");
      expect(event.findingsCount).toBe(1);
      expect(event.blockerCount).toBe(1);
    });
  });

  describe("getBlockerCount / getAdvisoryCount (AC6)", () => {
    it("counts correctly", () => {
      const review = Review.createNew({
        id: faker.string.uuid(),
        sliceId,
        role: "tff-code-reviewer",
        agentIdentity: "agent-1",
        now,
      });
      review.recordFindings(
        [
          {
            id: faker.string.uuid(),
            severity: "critical",
            message: "a",
            filePath: "f.ts",
            lineStart: 1,
          },
          {
            id: faker.string.uuid(),
            severity: "high",
            message: "b",
            filePath: "f.ts",
            lineStart: 2,
          },
          {
            id: faker.string.uuid(),
            severity: "medium",
            message: "c",
            filePath: "f.ts",
            lineStart: 3,
          },
          {
            id: faker.string.uuid(),
            severity: "low",
            message: "d",
            filePath: "f.ts",
            lineStart: 4,
          },
          {
            id: faker.string.uuid(),
            severity: "info",
            message: "e",
            filePath: "f.ts",
            lineStart: 5,
          },
        ],
        now,
      );
      expect(review.getBlockerCount()).toBe(2);
      expect(review.getAdvisoryCount()).toBe(3);
    });
  });
});
