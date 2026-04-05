import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { ProjectBuilder } from "@hexagons/project/domain/project.builder";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { Verification } from "@hexagons/review/domain/aggregates/verification.aggregate";
import { ReviewBuilder } from "@hexagons/review/domain/builders/review.builder";
import { InMemoryCompletionRecordRepository } from "@hexagons/review/infrastructure/repositories/completion-record/in-memory-completion-record.repository";
import { InMemoryReviewRepository } from "@hexagons/review/infrastructure/repositories/review/in-memory-review.repository";
import { InMemoryShipRecordRepository } from "@hexagons/review/infrastructure/repositories/ship-record/in-memory-ship-record.repository";
import { InMemoryVerificationRepository } from "@hexagons/review/infrastructure/repositories/verification/in-memory-verification.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { TaskBuilder } from "@hexagons/task/domain/task.builder";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { WorkflowSessionBuilder } from "@hexagons/workflow/domain/workflow-session.builder";
import { InMemoryWorkflowSessionRepository } from "@hexagons/workflow/infrastructure/in-memory-workflow-session.repository";
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
    workflowSessionRepo: new InMemoryWorkflowSessionRepository(),
    reviewRepo: new InMemoryReviewRepository(),
    verificationRepo: new InMemoryVerificationRepository(),
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
      milestones: [
        new MilestoneBuilder().withId(mId).withProjectId(pId).withLabel("M01").buildProps(),
      ],
      slices: [
        new SliceBuilder().withId(sId).withMilestoneId(mId).withLabel("M01-S01").buildProps(),
      ],
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

  it("v2 round-trip: export with workflow entities, re-import, verify survival", async () => {
    const sourceRepos = createRepos();
    const projectId = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();
    const sliceId = crypto.randomUUID();

    const project = new ProjectBuilder().withId(projectId).build();
    sourceRepos.projectRepo.seed(project);
    const milestone = new MilestoneBuilder()
      .withId(milestoneId)
      .withProjectId(projectId)
      .withLabel("M01")
      .build();
    sourceRepos.milestoneRepo.seed(milestone);

    // Seed workflow session
    const ws = new WorkflowSessionBuilder()
      .withMilestoneId(milestoneId)
      .withSliceId(sliceId)
      .withCurrentPhase("executing")
      .build();
    sourceRepos.workflowSessionRepo.seed(ws);

    // Seed review
    const review = new ReviewBuilder().withSliceId(sliceId).build();
    sourceRepos.reviewRepo.seed(review);

    // Seed verification
    const verification = Verification.createNew({
      id: crypto.randomUUID(),
      sliceId,
      agentIdentity: "test-agent",
      fixCycleIndex: 0,
      now: new Date(),
    });
    sourceRepos.verificationRepo.seed(verification);

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

    // Verify workflow session survived
    const wsResult = await targetRepos.workflowSessionRepo.findAll();
    expect(wsResult.ok).toBe(true);
    if (wsResult.ok) {
      expect(wsResult.data).toHaveLength(1);
      expect(wsResult.data[0].milestoneId).toBe(milestoneId);
      expect(wsResult.data[0].currentPhase).toBe("executing");
    }

    // Verify review survived
    const rvResult = await targetRepos.reviewRepo.findAll();
    expect(rvResult.ok).toBe(true);
    if (rvResult.ok) {
      expect(rvResult.data).toHaveLength(1);
      expect(rvResult.data[0].sliceId).toBe(sliceId);
    }

    // Verify verification survived
    const vfResult = await targetRepos.verificationRepo.findAll();
    expect(vfResult.ok).toBe(true);
    if (vfResult.ok) {
      expect(vfResult.data).toHaveLength(1);
      expect(vfResult.data[0].sliceId).toBe(sliceId);
    }
  });

  it("imports v1 snapshot (missing workflow fields) with migration", async () => {
    const repos = createRepos();
    const importer = new StateImporter(repos);

    const v1Snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      project: null,
      milestones: [],
      slices: [],
      tasks: [],
      shipRecords: [],
      completionRecords: [],
      // no workflowSessions, reviews, verifications
    };

    const result = await importer.import(v1Snapshot);
    expect(result.ok).toBe(true);

    // Should have empty arrays after migration
    const wsResult = await repos.workflowSessionRepo.findAll();
    expect(wsResult.ok && wsResult.data).toEqual([]);
    const rvResult = await repos.reviewRepo.findAll();
    expect(rvResult.ok && rvResult.data).toEqual([]);
    const vfResult = await repos.verificationRepo.findAll();
    expect(vfResult.ok && vfResult.data).toEqual([]);
  });
});
