import type { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import type { ProjectRepositoryPort } from "@hexagons/project/domain/ports/project-repository.port";
import type { Project } from "@hexagons/project/domain/project.aggregate";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import type { Slice } from "@hexagons/slice/domain/slice.aggregate";
import type { TaskRepositoryPort } from "@hexagons/task/domain/ports/task-repository.port";
import type { Task } from "@hexagons/task/domain/task.aggregate";
import { ok } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { OverlayDataAdapter } from "./overlay-data.adapter";

function stubProjectRepo(project: Project | null): ProjectRepositoryPort {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    findSingleton: vi.fn().mockResolvedValue(ok(project)),
    reset: vi.fn(),
  };
}

function stubMilestoneRepo(milestones: Milestone[]): MilestoneRepositoryPort {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    findByLabel: vi.fn(),
    findByProjectId: vi.fn().mockResolvedValue(ok(milestones)),
    reset: vi.fn(),
  };
}

function stubSliceRepo(slices: Slice[]): SliceRepositoryPort {
  return {
    save: vi.fn(),
    findById: vi
      .fn()
      .mockImplementation(async (id: string) => ok(slices.find((s) => s.id === id) ?? null)),
    findByLabel: vi.fn(),
    findByMilestoneId: vi.fn().mockResolvedValue(ok(slices)),
    findByKind: vi.fn().mockResolvedValue(ok([])),
    reset: vi.fn(),
  };
}

function stubTaskRepo(tasks: Task[]): TaskRepositoryPort {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    findByLabel: vi.fn(),
    findBySliceId: vi
      .fn()
      .mockImplementation(async (sliceId: string) =>
        ok(tasks.filter((t) => t.sliceId === sliceId)),
      ),
    reset: vi.fn(),
  };
}

// Minimal fakes for domain objects
function fakeProject(): Project {
  return { id: "proj-1", name: "Test" } as unknown as Project;
}

function fakeMilestone(
  overrides: Partial<{ id: string; status: string; projectId: string }> = {},
): Milestone {
  return {
    id: overrides.id ?? "ms-1",
    status: overrides.status ?? "in_progress",
    projectId: overrides.projectId ?? "proj-1",
  } as unknown as Milestone;
}

function fakeSlice(overrides: Partial<{ id: string; milestoneId: string }> = {}): Slice {
  return {
    id: overrides.id ?? "slice-1",
    milestoneId: overrides.milestoneId ?? "ms-1",
  } as unknown as Slice;
}

function fakeTask(overrides: Partial<{ id: string; sliceId: string; status: string }> = {}): Task {
  return {
    id: overrides.id ?? "task-1",
    sliceId: overrides.sliceId ?? "slice-1",
    status: overrides.status ?? "closed",
  } as unknown as Task;
}

describe("OverlayDataAdapter", () => {
  it("getProjectSnapshot returns project + active milestone + slices + task counts", async () => {
    const project = fakeProject();
    const milestone = fakeMilestone({ id: "ms-1", status: "in_progress", projectId: "proj-1" });
    const slice = fakeSlice({ id: "slice-1", milestoneId: "ms-1" });
    const tasks = [
      fakeTask({ id: "t1", sliceId: "slice-1", status: "closed" }),
      fakeTask({ id: "t2", sliceId: "slice-1", status: "open" }),
      fakeTask({ id: "t3", sliceId: "slice-1", status: "closed" }),
    ];

    const adapter = new OverlayDataAdapter(
      stubProjectRepo(project),
      stubMilestoneRepo([milestone]),
      stubSliceRepo([slice]),
      stubTaskRepo(tasks),
    );

    const result = await adapter.getProjectSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.project).toBe(project);
    expect(result.data.milestone).toBe(milestone);
    expect(result.data.slices).toEqual([slice]);
    expect(result.data.taskCounts.get("slice-1")).toEqual({ done: 2, total: 3 });
  });

  it("getProjectSnapshot filters out closed milestones", async () => {
    const project = fakeProject();
    const closedMs = fakeMilestone({ id: "ms-old", status: "closed", projectId: "proj-1" });
    const activeMs = fakeMilestone({ id: "ms-active", status: "in_progress", projectId: "proj-1" });

    const adapter = new OverlayDataAdapter(
      stubProjectRepo(project),
      stubMilestoneRepo([closedMs, activeMs]),
      stubSliceRepo([]),
      stubTaskRepo([]),
    );

    const result = await adapter.getProjectSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.milestone).toBe(activeMs);
  });

  it("getProjectSnapshot returns null milestone when all are closed", async () => {
    const project = fakeProject();
    const closedMs = fakeMilestone({ id: "ms-1", status: "closed", projectId: "proj-1" });

    const adapter = new OverlayDataAdapter(
      stubProjectRepo(project),
      stubMilestoneRepo([closedMs]),
      stubSliceRepo([]),
      stubTaskRepo([]),
    );

    const result = await adapter.getProjectSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.milestone).toBeNull();
    expect(result.data.slices).toEqual([]);
  });

  it("getSliceSnapshot returns slice + tasks", async () => {
    const slice = fakeSlice({ id: "slice-1" });
    const tasks = [
      fakeTask({ id: "t1", sliceId: "slice-1" }),
      fakeTask({ id: "t2", sliceId: "slice-1" }),
    ];

    const adapter = new OverlayDataAdapter(
      stubProjectRepo(null),
      stubMilestoneRepo([]),
      stubSliceRepo([slice]),
      stubTaskRepo(tasks),
    );

    const result = await adapter.getSliceSnapshot("slice-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.slice).toBe(slice);
    expect(result.data.tasks).toEqual(tasks);
  });

  it("getSliceSnapshot returns error when slice not found", async () => {
    const adapter = new OverlayDataAdapter(
      stubProjectRepo(null),
      stubMilestoneRepo([]),
      stubSliceRepo([]),
      stubTaskRepo([]),
    );

    const result = await adapter.getSliceSnapshot("nonexistent");
    expect(result.ok).toBe(false);
  });
});
