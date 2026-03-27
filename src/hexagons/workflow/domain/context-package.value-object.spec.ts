import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import type { ContextPackageProps } from "./context-package.schemas";
import { ContextPackage } from "./context-package.value-object";

function validProps(overrides?: Partial<ContextPackageProps>): ContextPackageProps {
  return {
    phase: "executing",
    sliceId: faker.string.uuid(),
    skills: [{ name: "test-driven-development", type: "rigid" }],
    agentType: "fixer",
    modelProfile: "balanced",
    filePaths: ["src/foo.ts"],
    taskPrompt: "Implement the feature",
    ...overrides,
  };
}

describe("ContextPackage", () => {
  describe("create", () => {
    it("creates a valid ContextPackage with all fields", () => {
      const props = validProps();
      const pkg = ContextPackage.create(props);
      expect(pkg.phase).toBe("executing");
      expect(pkg.sliceId).toBe(props.sliceId);
      expect(pkg.skills).toEqual([{ name: "test-driven-development", type: "rigid" }]);
      expect(pkg.agentType).toBe("fixer");
      expect(pkg.modelProfile).toBe("balanced");
      expect(pkg.filePaths).toEqual(["src/foo.ts"]);
      expect(pkg.taskPrompt).toBe("Implement the feature");
    });

    it("creates a ContextPackage with optional taskId", () => {
      const taskId = faker.string.uuid();
      const pkg = ContextPackage.create(validProps({ taskId }));
      expect(pkg.taskId).toBe(taskId);
    });

    it("creates a ContextPackage without taskId", () => {
      const pkg = ContextPackage.create(validProps());
      expect(pkg.taskId).toBeUndefined();
    });

    it("accepts empty skills array", () => {
      const pkg = ContextPackage.create(validProps({ skills: [] }));
      expect(pkg.skills).toEqual([]);
    });

    it("accepts up to 3 skills", () => {
      const pkg = ContextPackage.create(
        validProps({
          skills: [
            { name: "test-driven-development", type: "rigid" },
            { name: "hexagonal-architecture", type: "flexible" },
            { name: "commit-conventions", type: "rigid" },
          ],
        }),
      );
      expect(pkg.skills).toHaveLength(3);
    });

    it("rejects more than 3 skills", () => {
      expect(() =>
        ContextPackage.create(
          validProps({
            skills: [
              { name: "test-driven-development", type: "rigid" },
              { name: "hexagonal-architecture", type: "flexible" },
              { name: "commit-conventions", type: "rigid" },
              { name: "brainstorming", type: "flexible" },
            ],
          }),
        ),
      ).toThrow();
    });

    it("rejects invalid phase", () => {
      expect(() =>
        ContextPackage.create(Object.assign(validProps(), { phase: "invalid-phase" })),
      ).toThrow();
    });

    it("rejects invalid sliceId (non-UUID)", () => {
      expect(() =>
        ContextPackage.create(Object.assign(validProps(), { sliceId: "not-a-uuid" })),
      ).toThrow();
    });
  });

  describe("equals", () => {
    it("returns true for two packages with identical props", () => {
      const props = validProps();
      const a = ContextPackage.create(props);
      const b = ContextPackage.create(props);
      expect(a.equals(b)).toBe(true);
    });

    it("returns false for packages with different phases", () => {
      const base = validProps();
      const a = ContextPackage.create(base);
      const b = ContextPackage.create({ ...base, phase: "planning" });
      expect(a.equals(b)).toBe(false);
    });
  });
});
