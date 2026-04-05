import { describe, expect, it } from "vitest";
import type { PreDispatchContext } from "../../../../domain/pre-dispatch.schemas";
import { DependencyCheckRule } from "./dependency-check.rule";

function makeContext(overrides: Partial<PreDispatchContext> = {}): PreDispatchContext {
  return {
    taskId: "task-1",
    sliceId: "slice-1",
    milestoneId: "milestone-1",
    taskFilePaths: [],
    sliceFilePaths: [],
    expectedBranch: "slice/M07-S06",
    agentModel: "claude-sonnet-4-20250514",
    agentTools: [],
    upstreamTasks: [],
    ...overrides,
  };
}

describe("DependencyCheckRule", () => {
  const rule = new DependencyCheckRule();

  describe("evaluate", () => {
    it("returns blocker when upstream task status is in_progress", async () => {
      const violations = await rule.evaluate(
        makeContext({
          upstreamTasks: [{ id: "task-0", status: "in_progress" }],
        }),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe("dependency-check");
      expect(violations[0].severity).toBe("blocker");
      expect(violations[0].message).toContain("task-0");
      expect(violations[0].message).toContain("in_progress");
    });

    it("returns empty when all upstream tasks are completed", async () => {
      const violations = await rule.evaluate(
        makeContext({
          upstreamTasks: [
            { id: "task-0", status: "completed" },
            { id: "task-1", status: "completed" },
          ],
        }),
      );
      expect(violations).toEqual([]);
    });

    it("returns multiple violations for multiple incomplete deps", async () => {
      const violations = await rule.evaluate(
        makeContext({
          upstreamTasks: [
            { id: "task-a", status: "pending" },
            { id: "task-b", status: "in_progress" },
            { id: "task-c", status: "completed" },
          ],
        }),
      );
      expect(violations).toHaveLength(2);
      expect(violations.map((v) => v.message)).toEqual([
        "Upstream task task-a not completed (status: pending)",
        "Upstream task task-b not completed (status: in_progress)",
      ]);
    });

    it("returns empty for empty upstreamTasks array", async () => {
      const violations = await rule.evaluate(
        makeContext({ upstreamTasks: [] }),
      );
      expect(violations).toEqual([]);
    });
  });
});
