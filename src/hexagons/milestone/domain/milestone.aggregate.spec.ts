import { EVENT_NAMES, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Milestone } from "./milestone.aggregate";

describe("Milestone", () => {
  const id = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-06-01T00:00:00Z");

  describe("createNew", () => {
    it("creates a valid milestone with status open", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });

      expect(m.id).toBe(id);
      expect(m.projectId).toBe(projectId);
      expect(m.label).toBe("M01");
      expect(m.title).toBe("Kernel");
      expect(m.description).toBe("");
      expect(m.status).toBe("open");
      expect(m.createdAt).toEqual(now);
      expect(m.updatedAt).toEqual(now);
    });

    it("accepts optional description", () => {
      const m = Milestone.createNew({
        id,
        projectId,
        label: "M01",
        title: "Kernel",
        description: "Build kernel",
        now,
      });
      expect(m.description).toBe("Build kernel");
    });

    it("emits MilestoneCreatedEvent", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      const events = m.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.MILESTONE_CREATED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("derives branch from label", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      expect(m.branch).toBe("milestone/M01");
    });

    it("throws on invalid label format", () => {
      expect(() =>
        Milestone.createNew({ id, projectId, label: "bad", title: "Kernel", now }),
      ).toThrow();
    });

    it("throws on empty title", () => {
      expect(() => Milestone.createNew({ id, projectId, label: "M01", title: "", now })).toThrow();
    });

    it("throws on invalid id", () => {
      expect(() =>
        Milestone.createNew({ id: "not-a-uuid", projectId, label: "M01", title: "Kernel", now }),
      ).toThrow();
    });
  });

  describe("activate", () => {
    it("transitions open -> in_progress", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      const result = m.activate(later);

      expect(isOk(result)).toBe(true);
      expect(m.status).toBe("in_progress");
      expect(m.updatedAt).toEqual(later);
    });

    it("rejects in_progress -> in_progress", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      const result = m.activate(later);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("DOMAIN.INVALID_TRANSITION");
      }
    });

    it("rejects closed -> in_progress", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      m.close(later);
      const result = m.activate(later);

      expect(isErr(result)).toBe(true);
    });

    it("does not emit events", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.pullEvents(); // drain creation event
      m.activate(later);

      expect(m.pullEvents()).toEqual([]);
    });
  });

  describe("close", () => {
    it("transitions in_progress -> closed", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      const result = m.close(later);

      expect(isOk(result)).toBe(true);
      expect(m.status).toBe("closed");
    });

    it("emits MilestoneClosedEvent", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      m.pullEvents(); // drain prior events
      m.close(later);
      const events = m.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.MILESTONE_CLOSED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("rejects open -> closed", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      const result = m.close(later);

      expect(isErr(result)).toBe(true);
    });

    it("rejects closed -> closed", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      m.activate(later);
      m.close(later);
      const result = m.close(later);

      expect(isErr(result)).toBe(true);
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without emitting events", () => {
      const props = {
        id,
        projectId,
        label: "M01",
        title: "Kernel",
        description: "",
        status: "open" as const,
        createdAt: now,
        updatedAt: now,
      };
      const m = Milestone.reconstitute(props);

      expect(m.id).toBe(id);
      expect(m.label).toBe("M01");
      expect(m.pullEvents()).toEqual([]);
    });

    it("throws on invalid props", () => {
      expect(() =>
        Milestone.reconstitute({
          id: "not-a-uuid",
          projectId,
          label: "M01",
          title: "Kernel",
          description: "",
          status: "open" as const,
          createdAt: now,
          updatedAt: now,
        }),
      ).toThrow();
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const m = Milestone.createNew({ id, projectId, label: "M01", title: "Kernel", now });
      const json = m.toJSON();

      expect(json).toEqual({
        id,
        projectId,
        label: "M01",
        title: "Kernel",
        description: "",
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
    });
  });
});
