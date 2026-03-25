import { BaseDomainError } from "@kernel";

export class CyclicDependencyError extends BaseDomainError {
  readonly code = "TASK.CYCLIC_DEPENDENCY";

  constructor(cyclePath: readonly string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(" -> ")}`, {
      cyclePath,
    });
  }

  get cyclePath(): readonly string[] {
    return (this.metadata as { cyclePath: readonly string[] }).cyclePath;
  }
}
