import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { DetectWavesUseCase } from "../domain/detect-waves.use-case";
import { InMemoryTaskRepository } from "../infrastructure/in-memory-task.repository";
import { CreateTasksUseCase } from "./create-tasks.use-case";

function setup() {
  const taskRepo = new InMemoryTaskRepository();
  const waveDetection = new DetectWavesUseCase();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const useCase = new CreateTasksUseCase(taskRepo, waveDetection, dateProvider);
  return { useCase, taskRepo, fixedNow };
}

describe("CreateTasksUseCase", () => {
  it("should create tasks, resolve deps by label, detect waves, and assign waveIndex", async () => {
    const { useCase, taskRepo } = setup();
    const sliceId = crypto.randomUUID();
    const result = await useCase.createTasks({
      sliceId,
      tasks: [
        {
          label: "T01",
          title: "First",
          description: "desc",
          acceptanceCriteria: "AC1",
          filePaths: ["a.ts"],
          blockedBy: [],
        },
        {
          label: "T02",
          title: "Second",
          description: "desc",
          acceptanceCriteria: "AC2",
          filePaths: ["b.ts"],
          blockedBy: ["T01"],
        },
      ],
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.taskCount).toBe(2);
      expect(result.data.waveCount).toBe(2);
    }
    // Verify tasks persisted with correct waveIndex
    const tasks = await taskRepo.findBySliceId(sliceId);
    if (isOk(tasks)) {
      const t01 = tasks.data.find((t) => t.label === "T01");
      const t02 = tasks.data.find((t) => t.label === "T02");
      expect(t01?.waveIndex).toBe(0);
      expect(t02?.waveIndex).toBe(1);
      expect(t02?.blockedBy).toHaveLength(1);
    }
  });

  it("should return CyclicDependencyError when deps have cycles", async () => {
    const { useCase } = setup();
    const result = await useCase.createTasks({
      sliceId: crypto.randomUUID(),
      tasks: [
        {
          label: "T01",
          title: "A",
          description: "",
          acceptanceCriteria: "",
          filePaths: [],
          blockedBy: ["T02"],
        },
        {
          label: "T02",
          title: "B",
          description: "",
          acceptanceCriteria: "",
          filePaths: [],
          blockedBy: ["T01"],
        },
      ],
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("TASK.CYCLIC_DEPENDENCY");
    }
  });

  it("should handle tasks with no dependencies (single wave)", async () => {
    const { useCase, taskRepo } = setup();
    const sliceId = crypto.randomUUID();
    const result = await useCase.createTasks({
      sliceId,
      tasks: [
        {
          label: "T01",
          title: "A",
          description: "",
          acceptanceCriteria: "",
          filePaths: [],
          blockedBy: [],
        },
        {
          label: "T02",
          title: "B",
          description: "",
          acceptanceCriteria: "",
          filePaths: [],
          blockedBy: [],
        },
      ],
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.waveCount).toBe(1);
    }
    const tasks = await taskRepo.findBySliceId(sliceId);
    if (isOk(tasks)) {
      expect(tasks.data.every((t) => t.waveIndex === 0)).toBe(true);
    }
  });
});
