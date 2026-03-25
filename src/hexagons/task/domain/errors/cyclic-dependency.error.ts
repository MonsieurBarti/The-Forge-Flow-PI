import { BaseDomainError } from "@kernel";

export class CyclicDependencyError extends BaseDomainError {
  readonly code = "TASK.CYCLIC_DEPENDENCY";
  readonly cyclePath: readonly string[];

  constructor(cyclePath: readonly string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(" -> ")}`, {
      cyclePath,
    });
    this.cyclePath = cyclePath;
  }
}
