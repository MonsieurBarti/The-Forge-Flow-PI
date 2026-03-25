import { EVENT_NAMES } from "@kernel";
import { describe, expect, it } from "vitest";
import { Project } from "./project.aggregate";

describe("Project", () => {
  const id = crypto.randomUUID();
  const now = new Date("2026-01-01T00:00:00Z");

  describe("init", () => {
    it("creates a valid project with correct properties", () => {
      const project = Project.init({ id, name: "My Project", vision: "A great vision", now });

      expect(project.id).toBe(id);
      expect(project.name).toBe("My Project");
      expect(project.vision).toBe("A great vision");
      expect(project.createdAt).toEqual(now);
      expect(project.updatedAt).toEqual(now);
    });

    it("emits ProjectInitializedEvent", () => {
      const project = Project.init({ id, name: "My Project", vision: "A great vision", now });
      const events = project.pullEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe(EVENT_NAMES.PROJECT_INITIALIZED);
      expect(events[0].aggregateId).toBe(id);
    });

    it("throws ZodError on empty name", () => {
      expect(() => Project.init({ id, name: "", vision: "vision", now })).toThrow();
    });

    it("throws ZodError on invalid id", () => {
      expect(() =>
        Project.init({ id: "not-a-uuid", name: "name", vision: "vision", now }),
      ).toThrow();
    });
  });

  describe("updateVision", () => {
    it("updates vision and updatedAt", () => {
      const project = Project.init({ id, name: "My Project", vision: "Old vision", now });
      const later = new Date("2026-06-01T00:00:00Z");

      project.updateVision("New vision", later);

      expect(project.vision).toBe("New vision");
      expect(project.updatedAt).toEqual(later);
      expect(project.createdAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("hydrates from props without emitting events", () => {
      const props = {
        id,
        name: "My Project",
        vision: "vision",
        createdAt: now,
        updatedAt: now,
      };
      const project = Project.reconstitute(props);

      expect(project.id).toBe(id);
      expect(project.name).toBe("My Project");
      expect(project.pullEvents()).toEqual([]);
    });

    it("throws on invalid props", () => {
      expect(() =>
        Project.reconstitute({
          id: "not-a-uuid",
          name: "name",
          vision: "vision",
          createdAt: now,
          updatedAt: now,
        }),
      ).toThrow();
    });
  });

  describe("toJSON", () => {
    it("returns a copy of props", () => {
      const project = Project.init({ id, name: "My Project", vision: "vision", now });
      const json = project.toJSON();

      expect(json).toEqual({
        id,
        name: "My Project",
        vision: "vision",
        createdAt: now,
        updatedAt: now,
      });
    });
  });
});
