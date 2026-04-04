import { InMemoryCompletionRecordRepository } from "@hexagons/review/infrastructure/repositories/completion-record/in-memory-completion-record.repository";
import { InMemoryShipRecordRepository } from "@hexagons/review/infrastructure/repositories/ship-record/in-memory-ship-record.repository";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { ProjectBuilder } from "@hexagons/project/domain/project.builder";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { TaskBuilder } from "@hexagons/task/domain/task.builder";
import { describe, expect, it } from "vitest";
import { StateExporter } from "./state-exporter";

describe("StateExporter", () => {
  function createRepos() {
    return {
      projectRepo: new InMemoryProjectRepository(),
      milestoneRepo: new InMemoryMilestoneRepository(),
      sliceRepo: new InMemorySliceRepository(),
      taskRepo: new InMemoryTaskRepository(),
      shipRecordRepo: new InMemoryShipRecordRepository(),
      completionRecordRepo: new InMemoryCompletionRecordRepository(),
    };
  }

  it("exports empty state when no entities exist", async () => {
    const repos = createRepos();
    const exporter = new StateExporter(repos);
    const result = await exporter.export();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe(1);
    expect(result.data.project).toBeNull();
    expect(result.data.milestones).toEqual([]);
    expect(result.data.slices).toEqual([]);
    expect(result.data.tasks).toEqual([]);
    expect(result.data.shipRecords).toEqual([]);
    expect(result.data.completionRecords).toEqual([]);
  });

  it("exports all seeded entities", async () => {
    const repos = createRepos();
    const projectId = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();
    const sliceId = crypto.randomUUID();
    const taskId = crypto.randomUUID();

    const project = new ProjectBuilder().withId(projectId).build();
    repos.projectRepo.seed(project);

    const milestone = new MilestoneBuilder()
      .withId(milestoneId)
      .withProjectId(projectId)
      .withLabel("M01")
      .build();
    repos.milestoneRepo.seed(milestone);

    const slice = new SliceBuilder()
      .withId(sliceId)
      .withMilestoneId(milestoneId)
      .withLabel("M01-S01")
      .build();
    repos.sliceRepo.seed(slice);

    const task = new TaskBuilder().withId(taskId).withSliceId(sliceId).withLabel("T01").build();
    repos.taskRepo.seed(task);

    const exporter = new StateExporter(repos);
    const result = await exporter.export();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.project).not.toBeNull();
    expect(result.data.project?.id).toBe(projectId);
    expect(result.data.milestones).toHaveLength(1);
    expect(result.data.slices).toHaveLength(1);
    expect(result.data.tasks).toHaveLength(1);
  });
});
