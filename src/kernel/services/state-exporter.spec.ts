import { InMemoryCompletionRecordRepository } from "@hexagons/review/infrastructure/repositories/completion-record/in-memory-completion-record.repository";
import { InMemoryReviewRepository } from "@hexagons/review/infrastructure/repositories/review/in-memory-review.repository";
import { InMemoryShipRecordRepository } from "@hexagons/review/infrastructure/repositories/ship-record/in-memory-ship-record.repository";
import { InMemoryVerificationRepository } from "@hexagons/review/infrastructure/repositories/verification/in-memory-verification.repository";
import { ReviewBuilder } from "@hexagons/review/domain/builders/review.builder";
import { Verification } from "@hexagons/review/domain/aggregates/verification.aggregate";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { InMemoryWorkflowSessionRepository } from "@hexagons/workflow/infrastructure/in-memory-workflow-session.repository";
import { WorkflowSessionBuilder } from "@hexagons/workflow/domain/workflow-session.builder";
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
      workflowSessionRepo: new InMemoryWorkflowSessionRepository(),
      reviewRepo: new InMemoryReviewRepository(),
      verificationRepo: new InMemoryVerificationRepository(),
    };
  }

  it("exports empty state when no entities exist", async () => {
    const repos = createRepos();
    const exporter = new StateExporter(repos);
    const result = await exporter.export();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe(2);
    expect(result.data.project).toBeNull();
    expect(result.data.milestones).toEqual([]);
    expect(result.data.slices).toEqual([]);
    expect(result.data.tasks).toEqual([]);
    expect(result.data.shipRecords).toEqual([]);
    expect(result.data.completionRecords).toEqual([]);
    expect(result.data.workflowSessions).toEqual([]);
    expect(result.data.reviews).toEqual([]);
    expect(result.data.verifications).toEqual([]);
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

  it("exports workflow sessions, reviews, and verifications", async () => {
    const repos = createRepos();
    const projectId = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();
    const sliceId = crypto.randomUUID();

    const project = new ProjectBuilder().withId(projectId).build();
    repos.projectRepo.seed(project);
    const milestone = new MilestoneBuilder()
      .withId(milestoneId)
      .withProjectId(projectId)
      .withLabel("M01")
      .build();
    repos.milestoneRepo.seed(milestone);

    const ws = new WorkflowSessionBuilder()
      .withMilestoneId(milestoneId)
      .withSliceId(sliceId)
      .withCurrentPhase("executing")
      .build();
    repos.workflowSessionRepo.seed(ws);

    const review = new ReviewBuilder().withSliceId(sliceId).build();
    repos.reviewRepo.seed(review);

    const verification = Verification.createNew({
      id: crypto.randomUUID(),
      sliceId,
      agentIdentity: "test-agent",
      fixCycleIndex: 0,
      now: new Date(),
    });
    repos.verificationRepo.seed(verification);

    const exporter = new StateExporter(repos);
    const result = await exporter.export();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workflowSessions).toHaveLength(1);
    expect(result.data.workflowSessions[0].milestoneId).toBe(milestoneId);
    expect(result.data.reviews).toHaveLength(1);
    expect(result.data.reviews[0].sliceId).toBe(sliceId);
    expect(result.data.verifications).toHaveLength(1);
    expect(result.data.verifications[0].sliceId).toBe(sliceId);
  });
});
