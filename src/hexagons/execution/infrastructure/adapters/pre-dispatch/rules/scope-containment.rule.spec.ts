import { describe, expect, it } from "vitest";
import type { PreDispatchContext } from "../../../../domain/pre-dispatch.schemas";
import { ScopeContainmentRule } from "./scope-containment.rule";

function makeContext(overrides: Partial<PreDispatchContext> = {}): PreDispatchContext {
  return {
    taskId: "task-1",
    sliceId: "slice-1",
    milestoneId: "milestone-1",
    taskFilePaths: ["src/foo.ts"],
    sliceFilePaths: ["src/foo.ts", "src/bar.ts"],
    expectedBranch: "slice/M07-S06",
    agentModel: "claude-sonnet-4-20250514",
    agentTools: [],
    upstreamTasks: [],
    ...overrides,
  };
}

describe("ScopeContainmentRule", () => {
  const rule = new ScopeContainmentRule();

  describe("evaluate", () => {
    it("returns blocker when taskFilePaths has path NOT in sliceFilePaths", async () => {
      const violations = await rule.evaluate(
        makeContext({
          taskFilePaths: ["src/outside.ts"],
          sliceFilePaths: ["src/foo.ts"],
        }),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe("scope-containment");
      expect(violations[0].severity).toBe("blocker");
      expect(violations[0].message).toContain("src/outside.ts");
    });

    it("returns empty when all taskFilePaths are within sliceFilePaths", async () => {
      const violations = await rule.evaluate(
        makeContext({
          taskFilePaths: ["src/foo.ts", "src/bar.ts"],
          sliceFilePaths: ["src/foo.ts", "src/bar.ts", "src/baz.ts"],
        }),
      );
      expect(violations).toEqual([]);
    });

    it("returns multiple violations for multiple out-of-scope paths", async () => {
      const violations = await rule.evaluate(
        makeContext({
          taskFilePaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
          sliceFilePaths: ["src/c.ts"],
        }),
      );
      expect(violations).toHaveLength(2);
      expect(violations.map((v) => v.message)).toEqual([
        "File outside slice scope: src/a.ts",
        "File outside slice scope: src/b.ts",
      ]);
    });

    it("returns empty for empty taskFilePaths", async () => {
      const violations = await rule.evaluate(makeContext({ taskFilePaths: [] }));
      expect(violations).toEqual([]);
    });
  });
});
