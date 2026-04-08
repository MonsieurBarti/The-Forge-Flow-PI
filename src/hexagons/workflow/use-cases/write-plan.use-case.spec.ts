import { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { CyclicDependencyError } from "@hexagons/task/domain/errors/cyclic-dependency.error";
import { CreateTasksPort } from "@hexagons/task/domain/ports/create-tasks.port";
import { err, isErr, isOk, ok, PersistenceError } from "@kernel";
import { describe, expect, it } from "vitest";

import { FileIOError } from "../domain/errors/file-io.error";
import { ArtifactFilePort } from "../domain/ports/artifact-file.port";
import { InMemoryArtifactFileAdapter } from "../infrastructure/in-memory-artifact-file.adapter";
import { WritePlanUseCase } from "./write-plan.use-case";

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const artifactFile = new InMemoryArtifactFileAdapter();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const createTasksPort = Object.assign(Object.create(CreateTasksPort.prototype), {
    createTasks: async () => ok({ taskCount: 2, waveCount: 1 }),
  });
  const useCase = new WritePlanUseCase(artifactFile, sliceRepo, createTasksPort, dateProvider);
  return { useCase, sliceRepo, artifactFile, createTasksPort, dateProvider, fixedNow };
}

function makeInput(sliceId: string) {
  return {
    milestoneLabel: "M03",
    sliceLabel: "M03-S07",
    sliceId,
    content: "# Plan\n\nSome content",
    tasks: [
      {
        label: "T01",
        title: "First",
        description: "d",
        acceptanceCriteria: "AC1",
        filePaths: ["a.ts"],
        blockedBy: [],
      },
    ],
  };
}

describe("WritePlanUseCase", () => {
  it("should write PLAN.md, create tasks, and update slice planPath", async () => {
    const { useCase, sliceRepo } = setup();
    const sliceId = crypto.randomUUID();
    const slice = Slice.reconstitute(
      new SliceBuilder().withId(sliceId).withStatus("planning").buildProps(),
    );
    sliceRepo.seed(slice);

    const result = await useCase.execute(makeInput(sliceId));

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.path).toContain("PLAN.md");
      expect(result.data.taskCount).toBe(2);
      expect(result.data.waveCount).toBe(1);
    }

    const updated = await sliceRepo.findById(sliceId);
    if (isOk(updated) && updated.data) {
      expect(updated.data.planPath).toContain("PLAN.md");
    }
  });

  it("should return FileIOError when artifact write fails", async () => {
    const { sliceRepo, dateProvider } = setup();
    const sliceId = crypto.randomUUID();
    const slice = Slice.reconstitute(
      new SliceBuilder().withId(sliceId).withStatus("planning").buildProps(),
    );
    sliceRepo.seed(slice);

    const failingAdapter = Object.assign(Object.create(ArtifactFilePort.prototype), {
      write: async () => err(new FileIOError("Disk full")),
      read: async () => err(new FileIOError("Disk full")),
    });
    const createTasksPort = Object.assign(Object.create(CreateTasksPort.prototype), {
      createTasks: async () => ok({ taskCount: 0, waveCount: 0 }),
    });
    const failUseCase = new WritePlanUseCase(
      failingAdapter,
      sliceRepo,
      createTasksPort,
      dateProvider,
    );

    const result = await failUseCase.execute(makeInput(sliceId));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("WORKFLOW.FILE_IO");
  });

  it("should return SliceNotFoundError when slice missing", async () => {
    const { useCase } = setup();
    const result = await useCase.execute(makeInput(crypto.randomUUID()));
    expect(isErr(result)).toBe(true);
  });

  it("should return PersistenceError when repo save fails", async () => {
    const { artifactFile, dateProvider } = setup();
    const sliceId = crypto.randomUUID();
    const slice = Slice.reconstitute(
      new SliceBuilder().withId(sliceId).withStatus("planning").buildProps(),
    );

    const failingRepo = Object.assign(Object.create(SliceRepositoryPort.prototype), {
      findById: async () => ok(slice),
      save: async () => err(new PersistenceError("DB write failed")),
    });
    const createTasksPort = Object.assign(Object.create(CreateTasksPort.prototype), {
      createTasks: async () => ok({ taskCount: 1, waveCount: 1 }),
    });
    const failUseCase = new WritePlanUseCase(
      artifactFile,
      failingRepo,
      createTasksPort,
      dateProvider,
    );

    const result = await failUseCase.execute(makeInput(sliceId));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("PERSISTENCE.FAILURE");
  });

  it("should return CyclicDependencyError when tasks have cycles", async () => {
    const { sliceRepo, artifactFile, dateProvider } = setup();
    const sliceId = crypto.randomUUID();
    const slice = Slice.reconstitute(
      new SliceBuilder().withId(sliceId).withStatus("planning").buildProps(),
    );
    sliceRepo.seed(slice);

    const cyclePort = Object.assign(Object.create(CreateTasksPort.prototype), {
      createTasks: async () => err(new CyclicDependencyError(["T01", "T02", "T01"])),
    });
    const cycleUseCase = new WritePlanUseCase(artifactFile, sliceRepo, cyclePort, dateProvider);

    const result = await cycleUseCase.execute(makeInput(sliceId));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("TASK.CYCLIC_DEPENDENCY");
  });
});
