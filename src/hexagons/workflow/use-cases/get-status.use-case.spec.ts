import { faker } from "@faker-js/faker";
import { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { Project } from "@hexagons/project/domain/project.aggregate";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { Task } from "@hexagons/task/domain/task.aggregate";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { GetStatusUseCase } from "./get-status.use-case";

function setup() {
  const projectRepo = new InMemoryProjectRepository();
  const milestoneRepo = new InMemoryMilestoneRepository();
  const sliceRepo = new InMemorySliceRepository();
  const taskRepo = new InMemoryTaskRepository();
  const useCase = new GetStatusUseCase(projectRepo, milestoneRepo, sliceRepo, taskRepo);
  return { useCase, projectRepo, milestoneRepo, sliceRepo, taskRepo };
}

describe("GetStatusUseCase", () => {
  it("returns null project when no project exists", async () => {
    const { useCase } = setup();
    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.project).toBeNull();
      expect(result.data.activeMilestone).toBeNull();
      expect(result.data.slices).toEqual([]);
    }
  });

  it("returns project info with null milestone when none exist", async () => {
    const { useCase, projectRepo } = setup();
    const now = new Date();
    const project = Project.init({ id: faker.string.uuid(), name: "Test", vision: "Vision", now });
    projectRepo.seed(project);

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.project).toEqual({ name: "Test", vision: "Vision" });
      expect(result.data.activeMilestone).toBeNull();
    }
  });

  it("returns active milestone (first non-closed)", async () => {
    const { useCase, projectRepo, milestoneRepo } = setup();
    const now = new Date();
    const projectId = faker.string.uuid();
    const project = Project.init({ id: projectId, name: "Test", vision: "Vision", now });
    projectRepo.seed(project);

    const m1 = Milestone.reconstitute({
      id: faker.string.uuid(),
      projectId,
      label: "M01",
      title: "First",
      description: "",
      status: "closed",
      createdAt: now,
      updatedAt: now,
    });
    const m2 = Milestone.reconstitute({
      id: faker.string.uuid(),
      projectId,
      label: "M02",
      title: "Second",
      description: "",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    milestoneRepo.seed(m1);
    milestoneRepo.seed(m2);

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.activeMilestone?.label).toBe("M02");
    }
  });

  it("computes slice and task totals correctly", async () => {
    const { useCase, projectRepo, milestoneRepo, sliceRepo, taskRepo } = setup();
    const now = new Date();
    const projectId = faker.string.uuid();
    const milestoneId = faker.string.uuid();
    const sliceId = faker.string.uuid();

    projectRepo.seed(Project.init({ id: projectId, name: "Test", vision: "V", now }));

    milestoneRepo.seed(
      Milestone.reconstitute({
        id: milestoneId,
        projectId,
        label: "M01",
        title: "First",
        description: "",
        status: "in_progress",
        createdAt: now,
        updatedAt: now,
      }),
    );

    sliceRepo.seed(
      Slice.reconstitute({
        id: sliceId,
        milestoneId,
        label: "M01-S01",
        title: "Slice One",
        description: "",
        status: "executing",
        complexity: null,
        specPath: null,
        planPath: null,
        researchPath: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    taskRepo.seed(
      Task.reconstitute({
        id: faker.string.uuid(),
        sliceId,
        label: "T01",
        title: "Task 1",
        description: "Do thing",
        acceptanceCriteria: "AC1",
        filePaths: [],
        status: "closed",
        blockedBy: [],
        waveIndex: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    taskRepo.seed(
      Task.reconstitute({
        id: faker.string.uuid(),
        sliceId,
        label: "T02",
        title: "Task 2",
        description: "Do other",
        acceptanceCriteria: "AC2",
        filePaths: [],
        status: "open",
        blockedBy: [],
        waveIndex: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.slices).toHaveLength(1);
      expect(result.data.slices[0].taskCount).toBe(2);
      expect(result.data.slices[0].completedTaskCount).toBe(1);
      expect(result.data.totals).toEqual({
        totalSlices: 1,
        completedSlices: 0,
        totalTasks: 2,
        completedTasks: 1,
      });
    }
  });
});
