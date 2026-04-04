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
import { SCHEMA_VERSION } from "@kernel/infrastructure/state-branch/state-snapshot.schemas";
import { describe, expect, it } from "vitest";
import { StateExporter } from "./state-exporter";
import { StateImporter } from "./state-importer";

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

describe("StateImporter", () => {
  it("imports a valid snapshot into repos", async () => {
    const repos = createRepos();
    const importer = new StateImporter(repos);

    const pId = crypto.randomUUID();
    const mId = crypto.randomUUID();
    const sId = crypto.randomUUID();
    const tId = crypto.randomUUID();

    const snapshot = {
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      project: new ProjectBuilder().withId(pId).buildProps(),
      milestones: [new MilestoneBuilder().withId(mId).withProjectId(pId).withLabel("M01").buildProps()],
      slices: [new SliceBuilder().withId(sId).withMilestoneId(mId).withLabel("M01-S01").buildProps()],
      tasks: [new TaskBuilder().withId(tId).withSliceId(sId).withLabel("T01").buildProps()],
      shipRecords: [],
      completionRecords: [],
    };

    const result = await importer.import(snapshot);
    expect(result.ok).toBe(true);

    const project = await repos.projectRepo.findSingleton();
    expect(project.ok && project.data?.id).toBe(pId);

    const milestone = await repos.milestoneRepo.findById(mId);
    expect(milestone.ok && milestone.data?.id).toBe(mId);

    const slice = await repos.sliceRepo.findById(sId);
    expect(slice.ok && slice.data?.id).toBe(sId);

    const task = await repos.taskRepo.findById(tId);
    expect(task.ok && task.data?.id).toBe(tId);
  });

  it("handles missing optional fields via Zod defaults", async () => {
    const repos = createRepos();
    const importer = new StateImporter(repos);

    const snapshot = {
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      project: null,
      milestones: [],
      slices: [],
      tasks: [],
    };

    const result = await importer.import(snapshot);
    expect(result.ok).toBe(true);
  });

  it("round-trip: export → import produces identical state", async () => {
    const sourceRepos = createRepos();
    const projectId = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();
    const sliceId = crypto.randomUUID();
    const taskId = crypto.randomUUID();

    const project = new ProjectBuilder().withId(projectId).build();
    sourceRepos.projectRepo.seed(project);

    const milestone = new MilestoneBuilder()
      .withId(milestoneId)
      .withProjectId(projectId)
      .withLabel("M01")
      .build();
    sourceRepos.milestoneRepo.seed(milestone);

    const slice = new SliceBuilder()
      .withId(sliceId)
      .withMilestoneId(milestoneId)
      .withLabel("M01-S01")
      .build();
    sourceRepos.sliceRepo.seed(slice);

    const task = new TaskBuilder().withId(taskId).withSliceId(sliceId).withLabel("T01").build();
    sourceRepos.taskRepo.seed(task);

    // Export
    const exporter = new StateExporter(sourceRepos);
    const exportResult = await exporter.export();
    expect(exportResult.ok).toBe(true);
    if (!exportResult.ok) return;

    // JSON round-trip
    const json = JSON.parse(JSON.stringify(exportResult.data));

    // Import into fresh repos
    const targetRepos = createRepos();
    const importer = new StateImporter(targetRepos);
    const importResult = await importer.import(json);
    expect(importResult.ok).toBe(true);

    const p = await targetRepos.projectRepo.findSingleton();
    expect(p.ok && p.data?.id).toBe(projectId);
    expect(p.ok && p.data?.name).toBe(project.name);

    const m = await targetRepos.milestoneRepo.findById(milestoneId);
    expect(m.ok && m.data?.label).toBe("M01");

    const s = await targetRepos.sliceRepo.findById(sliceId);
    expect(s.ok && s.data?.label).toBe("M01-S01");

    const t = await targetRepos.taskRepo.findById(taskId);
    expect(t.ok && t.data?.label).toBe("T01");
  });
});
