import { EVENT_NAMES, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Slice } from "./slice.aggregate";

describe("Slice", () => {
  const id = crypto.randomUUID();
  const milestoneId = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-06-01T00:00:00Z");

  describe("createNew", () => {
    it("creates a valid slice with status discussing", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });

      expect(s.id).toBe(id);
      expect(s.milestoneId).toBe(milestoneId);
      expect(s.label).toBe("M01-S01");
      expect(s.title).toBe("Schemas");
      expect(s.description).toBe("");
      expect(s.status).toBe("discussing");
      expect(s.complexity).toBeNull();
      expect(s.specPath).toBeNull();
      expect(s.planPath).toBeNull();
      expect(s.researchPath).toBeNull();
      expect(s.createdAt).toEqual(now);
      expect(s.updatedAt).toEqual(now);
    });

    it("accepts optional description", () => {
      const s = Slice.createNew({
        id,
        milestoneId,
        label: "M01-S01",
        title: "Schemas",
        description: "Build schemas",
        now,
      });
      expect(s.description).toBe("Build schemas");
    });

    it("emits SliceCreatedEvent", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      const events = s.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.SLICE_CREATED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("throws on invalid label format", () => {
      expect(() =>
        Slice.createNew({ id, milestoneId, label: "bad", title: "Schemas", now }),
      ).toThrow();
    });

    it("throws on empty title", () => {
      expect(() =>
        Slice.createNew({ id, milestoneId, label: "M01-S01", title: "", now }),
      ).toThrow();
    });

    it("throws on invalid id", () => {
      expect(() =>
        Slice.createNew({ id: "not-a-uuid", milestoneId, label: "M01-S01", title: "Schemas", now }),
      ).toThrow();
    });
  });

  describe("transitionTo", () => {
    it("transitions discussing -> researching", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      const result = s.transitionTo("researching", later);

      expect(isOk(result)).toBe(true);
      expect(s.status).toBe("researching");
      expect(s.updatedAt).toEqual(later);
    });

    it("emits SliceStatusChangedEvent on non-self transition", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.pullEvents();
      s.transitionTo("researching", later);
      const events = s.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.SLICE_STATUS_CHANGED);
    });

    it("self-transition planning -> planning updates updatedAt but does NOT emit event", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.transitionTo("researching", now);
      s.transitionTo("planning", now);
      s.pullEvents();

      const result = s.transitionTo("planning", later);

      expect(isOk(result)).toBe(true);
      expect(s.status).toBe("planning");
      expect(s.updatedAt).toEqual(later);
      expect(s.pullEvents()).toEqual([]);
    });

    it("rejects invalid transition", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      const result = s.transitionTo("closed", later);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("DOMAIN.INVALID_TRANSITION");
      }
    });

    it("does not update status on invalid transition", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.transitionTo("closed", later);

      expect(s.status).toBe("discussing");
      expect(s.updatedAt).toEqual(now);
    });
  });

  describe("classify", () => {
    it("classifies as S-tier", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.classify(
        { architectureImpact: "none", requirementClarity: "clear", domainScope: "single" },
        later,
      );

      expect(s.complexity).toBe("S");
      expect(s.updatedAt).toEqual(later);
    });

    it("classifies as F-full", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.classify(
        { architectureImpact: "high", requirementClarity: "clear", domainScope: "single" },
        later,
      );

      expect(s.complexity).toBe("F-full");
    });

    it("classifies as F-lite", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      s.classify(
        { architectureImpact: "low", requirementClarity: "clear", domainScope: "single" },
        later,
      );

      expect(s.complexity).toBe("F-lite");
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without emitting events", () => {
      const props = {
        id,
        milestoneId,
        label: "M01-S01",
        title: "Schemas",
        description: "",
        status: "discussing" as const,
        complexity: null,
        specPath: null,
        planPath: null,
        researchPath: null,
        createdAt: now,
        updatedAt: now,
      };
      const s = Slice.reconstitute(props);

      expect(s.id).toBe(id);
      expect(s.label).toBe("M01-S01");
      expect(s.pullEvents()).toEqual([]);
    });

    it("throws on invalid props", () => {
      expect(() =>
        Slice.reconstitute({
          id: "not-a-uuid",
          milestoneId,
          label: "M01-S01",
          title: "Schemas",
          description: "",
          status: "discussing" as const,
          complexity: null,
          specPath: null,
          planPath: null,
          researchPath: null,
          createdAt: now,
          updatedAt: now,
        }),
      ).toThrow();
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });
      const json = s.toJSON();

      expect(json).toEqual({
        id,
        milestoneId,
        label: "M01-S01",
        title: "Schemas",
        description: "",
        status: "discussing",
        complexity: null,
        specPath: null,
        planPath: null,
        researchPath: null,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  describe("setSpecPath", () => {
    it("should set specPath and update updatedAt", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });

      s.setSpecPath("/path/to/SPEC.md", later);

      expect(s.specPath).toBe("/path/to/SPEC.md");
      expect(s.updatedAt).toEqual(later);
    });
  });

  describe("setComplexity", () => {
    it("should set complexity tier directly and update updatedAt", () => {
      const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });

      s.setComplexity("F-lite", later);

      expect(s.complexity).toBe("F-lite");
      expect(s.updatedAt).toEqual(later);
    });

    it("should allow overriding existing complexity", () => {
      const s = Slice.reconstitute({
        id,
        milestoneId,
        label: "M01-S01",
        title: "Schemas",
        description: "",
        status: "discussing" as const,
        complexity: "S" as const,
        specPath: null,
        planPath: null,
        researchPath: null,
        createdAt: now,
        updatedAt: now,
      });

      s.setComplexity("F-full", later);

      expect(s.complexity).toBe("F-full");
    });
  });
});
