import { describe, it, expect } from "vitest";
import { mergeSnapshots, type Snapshot } from "./json-snapshot-merger";

describe("mergeSnapshots", () => {
  it("merges disjoint entities — union of both", () => {
    const parent: Snapshot = {
      milestones: [],
      slices: [{ id: "S-A", name: "Slice A" }],
      tasks: [{ id: "T-1", sliceId: "S-A", title: "Task 1" }],
    };
    const child: Snapshot = {
      milestones: [],
      slices: [{ id: "S-B", name: "Slice B" }],
      tasks: [{ id: "T-2", sliceId: "S-B", title: "Task 2" }],
    };
    const result = mergeSnapshots(parent, child, "S-B");

    expect(result.slices).toHaveLength(2);
    expect(result.slices.map((s) => s.id)).toContain("S-A");
    expect(result.slices.map((s) => s.id)).toContain("S-B");
    expect(result.tasks).toHaveLength(2);
  });

  it("overlapping slice with matching sliceId — child wins", () => {
    const parent: Snapshot = {
      milestones: [],
      slices: [{ id: "M07-S01", name: "old name", status: "pending" }],
      tasks: [],
    };
    const child: Snapshot = {
      milestones: [],
      slices: [{ id: "M07-S01", name: "new name", status: "in-progress" }],
      tasks: [],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].name).toBe("new name");
    expect(result.slices[0].status).toBe("in-progress");
  });

  it("overlapping slice with different sliceId — parent wins", () => {
    const parent: Snapshot = {
      milestones: [],
      slices: [{ id: "S-OTHER", name: "parent version" }],
      tasks: [],
    };
    const child: Snapshot = {
      milestones: [],
      slices: [{ id: "S-OTHER", name: "child version" }],
      tasks: [],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].name).toBe("parent version");
  });

  it("overlapping task with same sliceId as child — child wins", () => {
    const parent: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [{ id: "T-1", sliceId: "M07-S01", title: "parent task" }],
    };
    const child: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [{ id: "T-1", sliceId: "M07-S01", title: "child task" }],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("child task");
  });

  it("overlapping task with different sliceId from child — parent wins", () => {
    const parent: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [{ id: "T-99", sliceId: "S-OTHER", title: "parent task" }],
    };
    const child: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [{ id: "T-99", sliceId: "S-OTHER", title: "child task" }],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("parent task");
  });

  it("project field — parent always wins", () => {
    const parent: Snapshot = {
      project: { name: "parent-project", version: 1 },
      milestones: [],
      slices: [],
      tasks: [],
    };
    const child: Snapshot = {
      project: { name: "child-project", version: 2 },
      milestones: [],
      slices: [],
      tasks: [],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.project).toEqual({ name: "parent-project", version: 1 });
  });

  it("milestones — parent always wins", () => {
    const parent: Snapshot = {
      milestones: [{ id: "M07", title: "parent milestone" }],
      slices: [],
      tasks: [],
    };
    const child: Snapshot = {
      milestones: [{ id: "M07", title: "child milestone" }],
      slices: [],
      tasks: [],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].title).toBe("parent milestone");
  });

  it("empty arrays — no crash", () => {
    const parent: Snapshot = { milestones: [], slices: [], tasks: [] };
    const child: Snapshot = { milestones: [], slices: [], tasks: [] };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.milestones).toHaveLength(0);
    expect(result.slices).toHaveLength(0);
    expect(result.tasks).toHaveLength(0);
  });

  it("undefined/missing arrays — no crash", () => {
    const parent = { milestones: undefined, slices: undefined, tasks: undefined } as unknown as Snapshot;
    const child = { milestones: undefined, slices: undefined, tasks: undefined } as unknown as Snapshot;
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.milestones).toEqual([]);
    expect(result.slices).toEqual([]);
    expect(result.tasks).toEqual([]);
  });

  it("shipRecords — child wins for owned slice", () => {
    const parent: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [],
      shipRecords: [{ id: "SR-1", sliceId: "M07-S01", outcome: "old" }],
    };
    const child: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [],
      shipRecords: [{ id: "SR-1", sliceId: "M07-S01", outcome: "merged" }],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.shipRecords).toHaveLength(1);
    expect(result.shipRecords![0].outcome).toBe("merged");
  });

  it("shipRecords — parent wins for non-owned slice", () => {
    const parent: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [],
      shipRecords: [{ id: "SR-2", sliceId: "S-OTHER", outcome: "parent" }],
    };
    const child: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [],
      shipRecords: [{ id: "SR-2", sliceId: "S-OTHER", outcome: "child" }],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.shipRecords).toHaveLength(1);
    expect(result.shipRecords![0].outcome).toBe("parent");
  });

  it("completionRecords — parent always wins", () => {
    const parent: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [],
      completionRecords: [{ id: "CR-1", outcome: "parent" }],
    };
    const child: Snapshot = {
      milestones: [],
      slices: [],
      tasks: [],
      completionRecords: [{ id: "CR-1", outcome: "child" }],
    };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.completionRecords).toHaveLength(1);
    expect(result.completionRecords![0].outcome).toBe("parent");
  });

  it("backward compat — missing shipRecords/completionRecords", () => {
    const parent: Snapshot = { milestones: [], slices: [], tasks: [] };
    const child: Snapshot = { milestones: [], slices: [], tasks: [] };
    const result = mergeSnapshots(parent, child, "M07-S01");

    expect(result.shipRecords).toEqual([]);
    expect(result.completionRecords).toEqual([]);
  });
});
