import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import type { CyclicDependencyError } from "@hexagons/task/domain/errors/cyclic-dependency.error";
import type { CreateTasksPort, TaskInput } from "@hexagons/task/domain/ports/create-tasks.port";
import type { DateProviderPort, PersistenceError } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";
import type { FileIOError } from "../domain/errors/file-io.error";
import { PhaseValidationError } from "../domain/errors/phase-validation.error";
import type { ArtifactFilePort } from "../domain/ports/artifact-file.port";

export interface WritePlanInput {
  milestoneLabel: string;
  sliceLabel: string;
  sliceId: string;
  content: string;
  tasks: TaskInput[];
}

export class WritePlanUseCase {
  constructor(
    private readonly artifactFilePort: ArtifactFilePort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly createTasksPort: CreateTasksPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(
    input: WritePlanInput,
  ): Promise<
    Result<
      { path: string; taskCount: number; waveCount: number },
      | FileIOError
      | SliceNotFoundError
      | PersistenceError
      | CyclicDependencyError
      | PhaseValidationError
    >
  > {
    // 1. Validate slice exists
    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(new SliceNotFoundError(input.sliceId));

    // 1b. Validate slice is in planning phase
    if (sliceResult.data.status !== "planning") {
      return err(new PhaseValidationError("write plan", "planning", sliceResult.data.status));
    }

    // 2. Write PLAN.md
    const writeResult = await this.artifactFilePort.write(
      input.milestoneLabel,
      input.sliceLabel,
      "plan",
      input.content,
    );
    if (isErr(writeResult)) return writeResult;

    // 3. Create tasks via cross-hexagon port
    const tasksResult = await this.createTasksPort.createTasks({
      sliceId: input.sliceId,
      tasks: input.tasks,
    });
    if (isErr(tasksResult)) return tasksResult;

    // 4. Update slice planPath
    sliceResult.data.setPlanPath(writeResult.data, this.dateProvider.now());
    const saveResult = await this.sliceRepo.save(sliceResult.data);
    if (isErr(saveResult)) return saveResult;

    return ok({
      path: writeResult.data,
      taskCount: tasksResult.data.taskCount,
      waveCount: tasksResult.data.waveCount,
    });
  }
}
