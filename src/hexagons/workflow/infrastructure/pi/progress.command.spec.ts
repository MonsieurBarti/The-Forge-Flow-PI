import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { ProjectBuilder } from "@hexagons/project/domain/project.builder";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import { err } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { GetStatusUseCase } from "../../use-cases/get-status.use-case";
import type { ProgressCommandDeps } from "./progress.command";
import { formatDashboard, registerProgressCommand } from "./progress.command";

// ---------------------------------------------------------------------------
// formatDashboard — pure function tests
// ---------------------------------------------------------------------------

describe("formatDashboard", () => {
  it("formats milestone title in header when active milestone exists", () => {
    const report = {
      project: { name: "TFF PI", vision: "Build the best project manager" },
      activeMilestone: { label: "M07", title: "Production Wiring", status: "open" as const },
      slices: [],
      totals: { totalSlices: 0, completedSlices: 0, totalTasks: 0, completedTasks: 0 },
    };
    const result = formatDashboard(report);
    expect(result).toContain("# State — M07: Production Wiring");
  });

  it("renders 'No active milestone' in header when activeMilestone is null", () => {
    const report = {
      project: null,
      activeMilestone: null,
      slices: [],
      totals: { totalSlices: 0, completedSlices: 0, totalTasks: 0, completedTasks: 0 },
    };
    const result = formatDashboard(report);
    expect(result).toContain("# State — No active milestone");
  });

  it("calculates progress percentages for slices and tasks", () => {
    const report = {
      project: { name: "P", vision: "V" },
      activeMilestone: { label: "M01", title: "First", status: "open" as const },
      slices: [
        {
          id: "slice-1",
          label: "M01-S01",
          title: "Slice One",
          status: "closed" as const,
          complexity: null,
          taskCount: 4,
          completedTaskCount: 2,
        },
      ],
      totals: { totalSlices: 1, completedSlices: 0, totalTasks: 4, completedTasks: 2 },
    };
    const result = formatDashboard(report);
    expect(result).toContain("- Slices: 0/1 completed");
    expect(result).toContain("- Tasks: 2/4 completed");
    expect(result).toContain("50%");
  });

  it("renders 0% when slice has no tasks", () => {
    const report = {
      project: { name: "P", vision: "V" },
      activeMilestone: { label: "M01", title: "First", status: "open" as const },
      slices: [
        {
          id: "slice-empty",
          label: "M01-S01",
          title: "Empty Slice",
          status: "discussing" as const,
          complexity: null,
          taskCount: 0,
          completedTaskCount: 0,
        },
      ],
      totals: { totalSlices: 1, completedSlices: 0, totalTasks: 0, completedTasks: 0 },
    };
    const result = formatDashboard(report);
    expect(result).toContain("| Empty Slice | discussing | 0/0 | 0% |");
  });

  it("renders slice table rows with label, status, tasks, and progress", () => {
    const report = {
      project: { name: "P", vision: "V" },
      activeMilestone: { label: "M02", title: "Second", status: "open" as const },
      slices: [
        {
          id: "slice-alpha",
          label: "M02-S01",
          title: "Alpha",
          status: "closed" as const,
          complexity: null,
          taskCount: 3,
          completedTaskCount: 3,
        },
        {
          id: "slice-beta",
          label: "M02-S02",
          title: "Beta",
          status: "discussing" as const,
          complexity: null,
          taskCount: 2,
          completedTaskCount: 1,
        },
      ],
      totals: { totalSlices: 2, completedSlices: 1, totalTasks: 5, completedTasks: 4 },
    };
    const result = formatDashboard(report);
    expect(result).toContain("| Alpha | closed | 3/3 | 100% |");
    expect(result).toContain("| Beta | discussing | 1/2 | 50% |");
    expect(result).toContain("- Slices: 1/2 completed");
    expect(result).toContain("- Tasks: 4/5 completed");
  });
});

// ---------------------------------------------------------------------------
// registerProgressCommand
// ---------------------------------------------------------------------------

function makeRealDeps() {
  const projectRepo = new InMemoryProjectRepository();
  const milestoneRepo = new InMemoryMilestoneRepository();
  const sliceRepo = new InMemorySliceRepository();
  const taskRepo = new InMemoryTaskRepository();
  const getStatus = new GetStatusUseCase(projectRepo, milestoneRepo, sliceRepo, taskRepo);
  return { projectRepo, milestoneRepo, sliceRepo, taskRepo, getStatus };
}

async function invokeHandler(deps: ProgressCommandDeps) {
  const { api, fns } = createMockExtensionAPI();
  registerProgressCommand(api, deps);
  const [, options] = fns.registerCommand.mock.calls[0];
  await options.handler("", undefined);
  return { fns };
}

describe("registerProgressCommand", () => {
  it("registers tff:progress command", () => {
    const { api, fns } = createMockExtensionAPI();
    const { getStatus } = makeRealDeps();
    registerProgressCommand(api, { getStatus, tffDir: "/tmp" });
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:progress",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("calls getStatus and sends dashboard message", async () => {
    const real = makeRealDeps();
    const project = new ProjectBuilder().withName("TFF PI").withVision("V").build();
    const milestoneProps = new MilestoneBuilder()
      .withLabel("M07")
      .withTitle("Wiring")
      .withProjectId(project.id)
      .buildProps();
    const milestone = Milestone.reconstitute(milestoneProps);
    const slice = new SliceBuilder()
      .withLabel("M07-S01")
      .withTitle("First Slice")
      .withMilestoneId(milestone.id)
      .build();
    real.projectRepo.seed(project);
    real.milestoneRepo.seed(milestone);
    real.sliceRepo.seed(slice);

    const tffDir = join(tmpdir(), `tff-test-${Date.now()}`);
    mkdirSync(tffDir, { recursive: true });

    const { fns } = await invokeHandler({ getStatus: real.getStatus, tffDir });
    expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("M07: Wiring"));
  });

  it("writes STATE.md when file does not exist (stale=true)", async () => {
    const real = makeRealDeps();
    const project = new ProjectBuilder().withName("TFF PI").withVision("V").build();
    const milestoneProps = new MilestoneBuilder()
      .withLabel("M07")
      .withTitle("Wiring")
      .withProjectId(project.id)
      .buildProps();
    const milestone = Milestone.reconstitute(milestoneProps);
    real.projectRepo.seed(project);
    real.milestoneRepo.seed(milestone);

    const tffDir = join(tmpdir(), `tff-test-write-${Date.now()}`);
    mkdirSync(tffDir, { recursive: true });

    await invokeHandler({ getStatus: real.getStatus, tffDir });

    const written = readFileSync(join(tffDir, "STATE.md"), "utf-8");
    expect(written).toContain("# State —");
  });

  it("writes STATE.md and reports stale when content differs", async () => {
    const real = makeRealDeps();
    const project = new ProjectBuilder().withName("TFF PI").withVision("V").build();
    const milestoneProps = new MilestoneBuilder()
      .withLabel("M07")
      .withTitle("Wiring")
      .withProjectId(project.id)
      .buildProps();
    const milestone = Milestone.reconstitute(milestoneProps);
    real.projectRepo.seed(project);
    real.milestoneRepo.seed(milestone);

    const tffDir = join(tmpdir(), `tff-test-stale-${Date.now()}`);
    mkdirSync(tffDir, { recursive: true });
    writeFileSync(join(tffDir, "STATE.md"), "old stale content", "utf-8");

    const { fns } = await invokeHandler({ getStatus: real.getStatus, tffDir });
    expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("auto-fixed"));

    const written = readFileSync(join(tffDir, "STATE.md"), "utf-8");
    expect(written).toContain("# State —");
    expect(written).not.toContain("old stale content");
  });

  it("does not write STATE.md and reports up-to-date when content matches", async () => {
    const real = makeRealDeps();
    const project = new ProjectBuilder().withName("TFF PI").withVision("V").build();
    const milestoneProps = new MilestoneBuilder()
      .withLabel("M07")
      .withTitle("Wiring")
      .withProjectId(project.id)
      .buildProps();
    const milestone = Milestone.reconstitute(milestoneProps);
    real.projectRepo.seed(project);
    real.milestoneRepo.seed(milestone);

    const tffDir = join(tmpdir(), `tff-test-current-${Date.now()}`);
    mkdirSync(tffDir, { recursive: true });

    // First call: writes the file
    await invokeHandler({ getStatus: real.getStatus, tffDir });

    // Second call: content matches
    const { fns } = await invokeHandler({ getStatus: real.getStatus, tffDir });
    expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("up-to-date"));
  });

  it("sends error message when getStatus fails", async () => {
    const getStatus = {
      execute: vi
        .fn()
        .mockResolvedValue(err({ message: "db connection failed", name: "PersistenceError" })),
    } as unknown as GetStatusUseCase;

    const tffDir = join(tmpdir(), `tff-test-err-${Date.now()}`);
    mkdirSync(tffDir, { recursive: true });

    const { fns } = await invokeHandler({ getStatus, tffDir });
    expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Error:"));
  });
});
