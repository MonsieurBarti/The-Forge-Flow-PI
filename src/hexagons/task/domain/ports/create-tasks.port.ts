import type { PersistenceError, Result } from "@kernel";
import type { CyclicDependencyError } from "../errors/cyclic-dependency.error";

export interface TaskInput {
  label: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  filePaths: string[];
  blockedBy: string[];
}

export interface CreateTasksResult {
  taskCount: number;
  waveCount: number;
}

export abstract class CreateTasksPort {
  abstract createTasks(params: {
    sliceId: string;
    tasks: TaskInput[];
  }): Promise<Result<CreateTasksResult, PersistenceError | CyclicDependencyError>>;
}
