import { BaseDomainError } from "@kernel";

export class CyclicDependencyError extends BaseDomainError {
  readonly code = "TASK.CYCLIC_DEPENDENCY";

  constructor(cyclePath: string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(" -> ")}`, { cyclePath });
  }
}
