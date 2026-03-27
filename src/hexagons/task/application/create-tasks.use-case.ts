import type { DateProviderPort, PersistenceError, Result } from "@kernel";
import { isErr, ok } from "@kernel";
import type { CyclicDependencyError } from "../domain/errors/cyclic-dependency.error";
import type {
  CreateTasksPort,
  CreateTasksResult,
  TaskInput,
} from "../domain/ports/create-tasks.port";
import type { TaskRepositoryPort } from "../domain/ports/task-repository.port";
import type { WaveDetectionPort } from "../domain/ports/wave-detection.port";
import { Task } from "../domain/task.aggregate";
import type { TaskDependencyInput } from "../domain/wave.schemas";

export class CreateTasksUseCase implements CreateTasksPort {
  constructor(
    private readonly taskRepo: TaskRepositoryPort,
    private readonly waveDetection: WaveDetectionPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async createTasks(params: {
    sliceId: string;
    tasks: TaskInput[];
  }): Promise<Result<CreateTasksResult, PersistenceError | CyclicDependencyError>> {
    const now = this.dateProvider.now();
    const labelToId = new Map<string, string>();

    // Pre-pass: generate UUIDs, build label->ID map
    for (const t of params.tasks) {
      labelToId.set(t.label, crypto.randomUUID());
    }

    // Creation pass: create all tasks with resolved blockedBy
    const tasks: Task[] = [];
    for (const t of params.tasks) {
      const resolvedBlockedBy = t.blockedBy
        .map((label) => labelToId.get(label))
        .filter((id): id is string => id !== undefined);

      const rawId = labelToId.get(t.label);
      if (rawId === undefined) continue;

      const task = Task.createNew({
        id: rawId,
        sliceId: params.sliceId,
        label: t.label,
        title: t.title,
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        filePaths: t.filePaths,
        blockedBy: resolvedBlockedBy,
        now,
      });
      const saveResult = await this.taskRepo.save(task);
      if (isErr(saveResult)) return saveResult;
      tasks.push(task);
    }

    // Wave detection
    const depInputs: TaskDependencyInput[] = tasks.map((t) => ({
      id: t.id,
      blockedBy: [...t.blockedBy],
    }));
    const wavesResult = this.waveDetection.detectWaves(depInputs);
    if (isErr(wavesResult)) return wavesResult;

    // Wave assignment
    for (const wave of wavesResult.data) {
      for (const taskId of wave.taskIds) {
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          task.assignToWave(wave.index, now);
          const saveResult = await this.taskRepo.save(task);
          if (isErr(saveResult)) return saveResult;
        }
      }
    }

    return ok({ taskCount: tasks.length, waveCount: wavesResult.data.length });
  }
}
