import { BaseDomainError } from "@kernel";

export class TaskNotFoundError extends BaseDomainError {
  readonly code = "TASK.NOT_FOUND";

  constructor(identifier: string) {
    super(`Task not found: ${identifier}`, { identifier });
  }
}
